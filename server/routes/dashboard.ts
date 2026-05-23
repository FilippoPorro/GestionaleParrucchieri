import { Router, Request, Response } from "express";
import { db } from "../db_parrucchieri";

const router = Router();
const REORDER_STOCK_THRESHOLD = 5;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${formatLocalDate(date)}T${hours}:${minutes}:${seconds}`;
}

function getCurrentHalfHourSlot(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setMinutes(date.getMinutes() < 30 ? 0 : 30, 0, 0);

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + 30);

  return { start, end };
}

function formatPersonName(user: any, fallback: string): string {
  const fullName = `${user?.cognome || ""} ${user?.nome || ""}`.trim();
  return fullName || fallback;
}

function formatTimeLabel(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = formatLocalDate(now);
    const startOfDay = `${today}T00:00:00`;
    const endOfDay = `${today}T23:59:59`;
    const currentSlot = getCurrentHalfHourSlot(now);
    const reminderWindowEnd = new Date(now);
    reminderWindowEnd.setHours(reminderWindowEnd.getHours() + 2);

    const [
      appuntamentiResult,
      pagamentiResult,
      prodottiResult,
      clientiInSaloneResult,
      reminderAppointmentsResult,
      lowStockProductsResult
    ] = await Promise.all([
      db
        .from("appuntamenti")
        .select("idAppuntamento, stato", { count: "exact" })
        .gte("dataOraInizio", startOfDay)
        .lte("dataOraInizio", endOfDay),
      db
        .from("pagamenti")
        .select("importo")
        .gte("data", startOfDay)
        .lte("data", endOfDay),
      db
        .from("prodotti")
        .select("idProdotto", { count: "exact", head: true })
        .lt("quantitaMagazzino", REORDER_STOCK_THRESHOLD),
      db
        .from("appuntamenti")
        .select("idCliente")
        .lt("dataOraInizio", formatLocalDateTime(currentSlot.end))
        .gt("dataOraFine", formatLocalDateTime(currentSlot.start)),
      db
        .from("appuntamenti")
        .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
        .not("idCliente", "is", null)
        .lt("dataOraInizio", formatLocalDateTime(reminderWindowEnd))
        .gt("dataOraFine", formatLocalDateTime(currentSlot.start))
        .order("dataOraInizio", { ascending: true })
        .limit(6),
      db
        .from("prodotti")
        .select("idProdotto, nome, quantitaMagazzino")
        .lt("quantitaMagazzino", REORDER_STOCK_THRESHOLD)
        .order("quantitaMagazzino", { ascending: true })
        .order("nome", { ascending: true })
    ]);

    if (appuntamentiResult.error) {
      throw appuntamentiResult.error;
    }

    if (pagamentiResult.error) {
      throw pagamentiResult.error;
    }

    if (prodottiResult.error) {
      throw prodottiResult.error;
    }

    if (clientiInSaloneResult.error) {
      throw clientiInSaloneResult.error;
    }

    if (reminderAppointmentsResult.error) {
      throw reminderAppointmentsResult.error;
    }

    if (lowStockProductsResult.error) {
      throw lowStockProductsResult.error;
    }

    const incassoGiornaliero = (pagamentiResult.data || []).reduce(
      (totale, pagamento) => totale + Number(pagamento.importo || 0),
      0
    );

    const appointmentIds = (appuntamentiResult.data || [])
      .filter((appuntamento: any) => String(appuntamento.stato || "prenotato").toLowerCase() !== "completato")
      .map((appuntamento: any) => Number(appuntamento.idAppuntamento))
      .filter(Number.isFinite);

    let incassoPrevistoAppuntamenti = 0;

    if (appointmentIds.length > 0) {
      const { data: relations, error: relationsError } = await db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio")
        .in("idAppuntamento", appointmentIds);

      if (relationsError) {
        throw relationsError;
      }

      const serviceIds = Array.from(
        new Set((relations || []).map((relation: any) => Number(relation.idServizio)).filter(Number.isFinite))
      );

      if (serviceIds.length > 0) {
        const { data: services, error: servicesError } = await db
          .from("servizi")
          .select("idServizio, prezzo")
          .in("idServizio", serviceIds);

        if (servicesError) {
          throw servicesError;
        }

        const pricesByServiceId = new Map<number, number>();
        (services || []).forEach((service: any) => {
          pricesByServiceId.set(Number(service.idServizio), Number(service.prezzo || 0));
        });

        incassoPrevistoAppuntamenti = (relations || []).reduce(
          (totale: number, relation: any) => totale + (pricesByServiceId.get(Number(relation.idServizio)) || 0),
          0
        );
      }
    }

    const clientiInSalone = new Set(
      (clientiInSaloneResult.data || [])
        .map((appuntamento) => appuntamento.idCliente)
        .filter((idCliente) => idCliente !== null && idCliente !== undefined)
    ).size;

    const reminderAppointments = (reminderAppointmentsResult.data || []).filter((appointment: any) => {
      const stato = String(appointment.stato || "prenotato").toLowerCase();
      return stato !== "completato";
    });

    const reminderAppointmentIds = reminderAppointments
      .map((appointment: any) => Number(appointment.idAppuntamento))
      .filter(Number.isFinite);
    const reminderClienteIds = Array.from(
      new Set(reminderAppointments.map((appointment: any) => Number(appointment.idCliente)).filter(Number.isFinite))
    );
    const reminderOperatoreIds = Array.from(
      new Set(reminderAppointments.map((appointment: any) => Number(appointment.idOperatore)).filter(Number.isFinite))
    );

    const [
      reminderRelationsResult,
      reminderClientiResult,
      reminderOperatoriResult
    ] = reminderAppointmentIds.length > 0
      ? await Promise.all([
        db
          .from("appuntamentiservizi")
          .select("idAppuntamento, idServizio")
          .in("idAppuntamento", reminderAppointmentIds),
        db
          .from("utenti")
          .select("idUtente, nome, cognome")
          .in("idUtente", reminderClienteIds),
        db
          .from("utenti")
          .select("idUtente, nome, cognome")
          .in("idUtente", reminderOperatoreIds)
      ])
      : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null }
      ];

    if (reminderRelationsResult.error) {
      throw reminderRelationsResult.error;
    }

    if (reminderClientiResult.error) {
      throw reminderClientiResult.error;
    }

    if (reminderOperatoriResult.error) {
      throw reminderOperatoriResult.error;
    }

    const reminderServiceIds = Array.from(
      new Set((reminderRelationsResult.data || []).map((relation: any) => Number(relation.idServizio)).filter(Number.isFinite))
    );
    const reminderServicesResult = reminderServiceIds.length > 0
      ? await db
        .from("servizi")
        .select("idServizio, nome")
        .in("idServizio", reminderServiceIds)
      : { data: [], error: null };

    if (reminderServicesResult.error) {
      throw reminderServicesResult.error;
    }

    const reminderClientiById = new Map<number, any>();
    (reminderClientiResult.data || []).forEach((cliente: any) => {
      reminderClientiById.set(Number(cliente.idUtente), cliente);
    });

    const reminderOperatoriById = new Map<number, any>();
    (reminderOperatoriResult.data || []).forEach((operatore: any) => {
      reminderOperatoriById.set(Number(operatore.idUtente), operatore);
    });

    const reminderServicesById = new Map<number, any>();
    (reminderServicesResult.data || []).forEach((service: any) => {
      reminderServicesById.set(Number(service.idServizio), service);
    });

    const reminderServiceNamesByAppointmentId = new Map<number, string[]>();
    (reminderRelationsResult.data || []).forEach((relation: any) => {
      const appointmentId = Number(relation.idAppuntamento);
      const service = reminderServicesById.get(Number(relation.idServizio));

      if (!service) {
        return;
      }

      const current = reminderServiceNamesByAppointmentId.get(appointmentId) || [];
      current.push(String(service.nome || "Servizio"));
      reminderServiceNamesByAppointmentId.set(appointmentId, current);
    });

    const appuntamentiPromemoria = reminderAppointments.slice(0, 4).map((appointment: any) => {
      const start = new Date(appointment.dataOraInizio);
      const end = new Date(appointment.dataOraFine);
      const cliente = reminderClientiById.get(Number(appointment.idCliente));
      const operatore = reminderOperatoriById.get(Number(appointment.idOperatore));
      const isCurrent = start < currentSlot.end && end > currentSlot.start;
      const serviceNames = reminderServiceNamesByAppointmentId.get(Number(appointment.idAppuntamento)) || [];

      return {
        idAppuntamento: Number(appointment.idAppuntamento),
        clienteNome: formatPersonName(cliente, "Cliente"),
        operatoreNome: formatPersonName(operatore, "Operatore"),
        ora: formatTimeLabel(appointment.dataOraInizio),
        oraFine: formatTimeLabel(appointment.dataOraFine),
        servizio: serviceNames[0] || appointment.note || "Appuntamento",
        stato: isCurrent ? "in_corso" : "in_arrivo"
      };
    });

    const prodottiPromemoria = (lowStockProductsResult.data || []).map((product: any) => ({
      idProdotto: Number(product.idProdotto),
      nome: String(product.nome || "Prodotto"),
      quantita: Number(product.quantitaMagazzino || 0)
    }));

    return res.json({
      data: today,
      slotCorrente: {
        inizio: formatLocalDateTime(currentSlot.start),
        fine: formatLocalDateTime(currentSlot.end)
      },
      appuntamentiOggi: appuntamentiResult.count ?? 0,
      incassoGiornaliero,
      incassoPrevistoAppuntamenti,
      prodottiInRiordino: prodottiResult.count ?? 0,
      clientiInSalone,
      sogliaRiordino: REORDER_STOCK_THRESHOLD,
      promemoria: {
        appuntamenti: appuntamentiPromemoria,
        prodotti: prodottiPromemoria
      }
    });
  } catch (err: any) {
    console.error("Errore GET /dashboard/stats:", err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
