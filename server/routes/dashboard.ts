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

function parseReportDays(value: unknown): number {
  const days = Number(value);

  if (!Number.isFinite(days)) {
    return 30;
  }

  return Math.min(Math.max(Math.trunc(days), 7), 365);
}

function startOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function endOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

function startOfWeek(date: Date): Date {
  const normalized = startOfDay(date);
  const day = normalized.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + diff);
  return normalized;
}

function formatWeekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatLocalDate(start)} - ${formatLocalDate(end)}`;
}

function getDiscountByFrequency(monthlyFrequency: number): number {
  if (monthlyFrequency < 1) {
    return 0;
  }

  if (monthlyFrequency < 2) {
    return 5;
  }

  if (monthlyFrequency < 3) {
    return 10;
  }

  if (monthlyFrequency < 4) {
    return 15;
  }

  return 20;
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
      let { data: relations, error: relationsError }: { data: any[] | null; error: any } = await db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio, prezzoPersonalizzato")
        .in("idAppuntamento", appointmentIds);

      if (relationsError && String(relationsError.message || "").toLowerCase().includes("prezzopersonalizzato")) {
        const fallbackRelations = await db
          .from("appuntamentiservizi")
          .select("idAppuntamento, idServizio")
          .in("idAppuntamento", appointmentIds);
        relations = fallbackRelations.data;
        relationsError = fallbackRelations.error;
      }

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
          (totale: number, relation: any) => {
            const customPrice = Number(relation.prezzoPersonalizzato);
            return totale + (
              Number.isFinite(customPrice)
                ? customPrice
                : pricesByServiceId.get(Number(relation.idServizio)) || 0
            );
          },
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

router.get("/report", async (req: Request, res: Response) => {
  try {
    const days = parseReportDays(req.query.days);
    const now = new Date();
    const rangeStartDate = startOfDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    const rangeEndDate = endOfDay(now);
    const rangeStart = formatLocalDateTime(rangeStartDate);
    const rangeEnd = formatLocalDateTime(rangeEndDate);
    const yearStartDate = startOfDay(new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000));
    const yearStart = formatLocalDateTime(yearStartDate);

    const [venditeResult, pagamentiResult, appuntamentiResult, annualAppointmentsResult] = await Promise.all([
      db
        .from("vendite")
        .select("idVendita, idCliente, data, totale")
        .gte("data", rangeStart)
        .lte("data", rangeEnd)
        .order("data", { ascending: true }),
      db
        .from("pagamenti")
        .select("metodo, importo, data")
        .gte("data", rangeStart)
        .lte("data", rangeEnd),
      db
        .from("appuntamenti")
        .select("idAppuntamento, dataOraInizio, stato")
        .gte("dataOraInizio", rangeStart)
        .lte("dataOraInizio", rangeEnd),
      db
        .from("appuntamenti")
        .select("idAppuntamento, idCliente, dataOraInizio, stato")
        .not("idCliente", "is", null)
        .gte("dataOraInizio", yearStart)
        .lte("dataOraInizio", rangeEnd)
    ]);

    if (venditeResult.error) {
      throw venditeResult.error;
    }

    if (pagamentiResult.error) {
      throw pagamentiResult.error;
    }

    if (appuntamentiResult.error) {
      throw appuntamentiResult.error;
    }

    if (annualAppointmentsResult.error) {
      throw annualAppointmentsResult.error;
    }

    const vendite = venditeResult.data || [];
    const pagamenti = pagamentiResult.data || [];
    const appuntamenti = appuntamentiResult.data || [];
    const annualAppointments = annualAppointmentsResult.data || [];

    const venditaIds = vendite
      .map((vendita: any) => Number(vendita.idVendita))
      .filter(Number.isFinite);

    const dettagliVenditaResult = venditaIds.length > 0
      ? await db
        .from("dettagliovendita")
        .select("idVendita, idProdotto, quantita, prezzoUnitario")
        .in("idVendita", venditaIds)
      : { data: [], error: null };

    if (dettagliVenditaResult.error) {
      throw dettagliVenditaResult.error;
    }

    const dettagliVendita = dettagliVenditaResult.data || [];
    const productIds = Array.from(
      new Set(dettagliVendita.map((item: any) => Number(item.idProdotto)).filter(Number.isFinite))
    );

    const prodottiResult = productIds.length > 0
      ? await db
        .from("prodotti")
        .select("idProdotto, nome, marca, categoria")
        .in("idProdotto", productIds)
      : { data: [], error: null };

    if (prodottiResult.error) {
      throw prodottiResult.error;
    }

    const completedAppointments = appuntamenti.filter(
      (appointment: any) => String(appointment.stato || "").toLowerCase() === "completato"
    );

    const completedAnnualAppointments = annualAppointments.filter(
      (appointment: any) => String(appointment.stato || "").toLowerCase() === "completato"
    );

    const annualCustomerIds = Array.from(
      new Set(completedAnnualAppointments.map((appointment: any) => Number(appointment.idCliente)).filter(Number.isFinite))
    );

    const clientiResult = annualCustomerIds.length > 0
      ? await db
        .from("utenti")
        .select("idUtente, nome, cognome")
        .in("idUtente", annualCustomerIds)
      : { data: [], error: null };

    if (clientiResult.error) {
      throw clientiResult.error;
    }

    const totalRevenue = vendite.reduce((sum: number, sale: any) => sum + Number(sale.totale || 0), 0);
    const totalSales = vendite.length;
    const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
    const totalProductsSold = dettagliVendita.reduce((sum: number, item: any) => sum + Number(item.quantita || 0), 0);
    const totalCompletedAppointments = completedAppointments.length;

    const contantiRevenue = pagamenti
      .filter((payment: any) => String(payment.metodo || "").toLowerCase() === "contanti")
      .reduce((sum: number, payment: any) => sum + Number(payment.importo || 0), 0);
    const cartaRevenue = pagamenti
      .filter((payment: any) => String(payment.metodo || "").toLowerCase() === "carta")
      .reduce((sum: number, payment: any) => sum + Number(payment.importo || 0), 0);

    const productsById = new Map<number, any>();
    (prodottiResult.data || []).forEach((product: any) => {
      productsById.set(Number(product.idProdotto), product);
    });

    const revenueByCategoryMap = new Map<string, number>();
    dettagliVendita.forEach((item: any) => {
      const id = Number(item.idProdotto);
      const quantity = Number(item.quantita || 0);
      const revenue = quantity * Number(item.prezzoUnitario || 0);
      const product = productsById.get(id);
      const category = String(product?.categoria || "Senza categoria").trim() || "Senza categoria";
      revenueByCategoryMap.set(category, (revenueByCategoryMap.get(category) || 0) + revenue);
    });

    const paymentDistribution = [
      { label: "Carta", value: Number(cartaRevenue.toFixed(2)) },
      { label: "Contanti", value: Number(contantiRevenue.toFixed(2)) }
    ];

    const weekBuckets = new Map<string, { start: Date; value: number }>();
    vendite.forEach((sale: any) => {
      const saleDate = new Date(sale.data);
      const bucketStart = startOfWeek(saleDate);
      const key = formatLocalDate(bucketStart);
      const current = weekBuckets.get(key) || { start: bucketStart, value: 0 };
      current.value += Number(sale.totale || 0);
      weekBuckets.set(key, current);
    });

    const weeklyRevenueTrend = Array.from(weekBuckets.values())
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((bucket, index, buckets) => {
        const value = Number(bucket.value.toFixed(2));
        const previousValue = index > 0 ? Number(buckets[index - 1].value.toFixed(2)) : value;
        return {
          label: formatWeekLabel(bucket.start),
          value,
          delta: Number((value - previousValue).toFixed(2))
        };
      });

    const customersById = new Map<number, any>();
    (clientiResult.data || []).forEach((customer: any) => {
      customersById.set(Number(customer.idUtente), customer);
    });

    const customerFrequencyMap = new Map<number, number>();
    completedAnnualAppointments.forEach((appointment: any) => {
      const customerId = Number(appointment.idCliente);
      if (!Number.isFinite(customerId)) {
        return;
      }

      customerFrequencyMap.set(customerId, (customerFrequencyMap.get(customerId) || 0) + 1);
    });

    const customerFrequency = Array.from(customerFrequencyMap.entries())
      .map(([id, appointments]) => {
        const customer = customersById.get(id);
        const monthlyFrequency = Number((appointments / 12).toFixed(2));
        return {
          id,
          name: formatPersonName(customer, `Cliente #${id}`),
          appointments,
          monthlyFrequency,
          discount: getDiscountByFrequency(monthlyFrequency)
        };
      })
      .sort((a, b) => b.monthlyFrequency - a.monthlyFrequency || b.appointments - a.appointments || a.name.localeCompare(b.name));

    return res.json({
      range: {
        days,
        start: formatLocalDate(rangeStartDate),
        end: formatLocalDate(rangeEndDate)
      },
      summary: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalSales,
        averageTicket: Number(averageTicket.toFixed(2)),
        totalProductsSold,
        totalCompletedAppointments
      },
      charts: {
        revenueByCategory: Array.from(revenueByCategoryMap.entries())
          .map(([label, value]) => ({
            label,
            value: Number(value.toFixed(2))
          }))
          .sort((a, b) => b.value - a.value),
        paymentDistribution,
        weeklyRevenueTrend
      },
      payments: {
        total: Number((cartaRevenue + contantiRevenue).toFixed(2)),
        card: Number(cartaRevenue.toFixed(2)),
        cash: Number(contantiRevenue.toFixed(2))
      },
      customers: {
        frequency: customerFrequency
      }
    });
  } catch (err: any) {
    console.error("Errore GET /dashboard/report:", err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
