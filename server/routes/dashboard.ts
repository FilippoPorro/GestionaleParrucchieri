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

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = formatLocalDate(now);
    const startOfDay = `${today}T00:00:00`;
    const endOfDay = `${today}T23:59:59`;
    const currentSlot = getCurrentHalfHourSlot(now);

    const [
      appuntamentiResult,
      pagamentiResult,
      prodottiResult,
      clientiInSaloneResult
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
        .lte("quantitaMagazzino", REORDER_STOCK_THRESHOLD),
      db
        .from("appuntamenti")
        .select("idCliente")
        .lt("dataOraInizio", formatLocalDateTime(currentSlot.end))
        .gt("dataOraFine", formatLocalDateTime(currentSlot.start))
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
      sogliaRiordino: REORDER_STOCK_THRESHOLD
    });
  } catch (err: any) {
    console.error("Errore GET /dashboard/stats:", err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
