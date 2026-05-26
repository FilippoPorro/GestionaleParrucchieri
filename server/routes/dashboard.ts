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

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function removeAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value: unknown): string {
  return removeAccents(normalizeText(value));
}

function resolveCustomerSegment(service: any): "donna" | "uomo" | "bambino" | "non_classificato" {
  const category = normalizeKey(service?.categoria);
  const subcategory = normalizeKey(service?.sottocategoria);
  const name = normalizeKey(service?.nome);
  const haystack = `${category} ${subcategory} ${name}`;

  if (haystack.includes("bambin")) {
    return "bambino";
  }

  if (haystack.includes("uomo") || haystack.includes("barba") || haystack.includes("man")) {
    return "uomo";
  }

  if (haystack.includes("donna") || haystack.includes("woman")) {
    return "donna";
  }

  return "non_classificato";
}

function calculateAgeFromBirthDate(value: unknown, referenceDate: Date): number | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const birthDate = new Date(`${raw.substring(0, 10)}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = referenceDate.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birthDate.getDate())) {
    age--;
  }

  return age >= 0 ? age : null;
}

function getAgeRangeLabel(age: number): string {
  if (age < 10) return "0-9";

  const start = Math.floor(age / 10) * 10;
  const end = start + 9;

  if (start >= 70) {
    return "70+";
  }

  return `${start}-${end}`;
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
        .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, stato")
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
        .from("dettagliovenditaProdotti")
        .select("idVendita, idProdotto, quantita, prezzoUnitario")
        .in("idVendita", venditaIds)
      : { data: [], error: null };

    const dettagliVenditaServiziResult = venditaIds.length > 0
      ? await db
        .from("dettaglioVenditaServizi")
        .select("idVendita, idServizio, prezzoUnitario")
        .in("idVendita", venditaIds)
      : { data: [], error: null };

    if (dettagliVenditaResult.error) {
      throw dettagliVenditaResult.error;
    }

    if (dettagliVenditaServiziResult.error) {
      throw dettagliVenditaServiziResult.error;
    }

    const dettagliVendita = dettagliVenditaResult.data || [];
    const dettagliVenditaServizi = dettagliVenditaServiziResult.data || [];
    const productIds = Array.from(
      new Set(dettagliVendita.map((item: any) => Number(item.idProdotto)).filter(Number.isFinite))
    );

    const prodottiResult = productIds.length > 0
      ? await db
        .from("prodotti")
        .select("idProdotto, nome, marca, categoria, prezzoRivendita")
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

    const completedAppointmentIds = completedAppointments
      .map((appointment: any) => Number(appointment.idAppuntamento))
      .filter(Number.isFinite);

    const completedOperatorIds = Array.from(
      new Set(completedAppointments.map((appointment: any) => Number(appointment.idOperatore)).filter(Number.isFinite))
    );

    const [
      clientiResult,
      operatoriResult,
      completedAppointmentServicesResult
    ] = await Promise.all([
      annualCustomerIds.length > 0
      ? await db
        .from("utenti")
        .select("idUtente, nome, cognome, data_nascita")
        .in("idUtente", annualCustomerIds)
      : { data: [], error: null },
      completedOperatorIds.length > 0
      ? await db
        .from("utenti")
        .select("idUtente, nome, cognome")
        .in("idUtente", completedOperatorIds)
      : { data: [], error: null },
      completedAppointmentIds.length > 0
      ? await db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio, prezzoPersonalizzato")
        .in("idAppuntamento", completedAppointmentIds)
      : { data: [], error: null }
    ]);

    if (clientiResult.error) {
      throw clientiResult.error;
    }

    if (operatoriResult.error) {
      throw operatoriResult.error;
    }

    if (completedAppointmentServicesResult.error) {
      if (!String(completedAppointmentServicesResult.error.message || "").toLowerCase().includes("prezzopersonalizzato")) {
        throw completedAppointmentServicesResult.error;
      }

      const fallbackCompletedAppointmentServicesResult = await db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio")
        .in("idAppuntamento", completedAppointmentIds);

      if (fallbackCompletedAppointmentServicesResult.error) {
        throw fallbackCompletedAppointmentServicesResult.error;
      }

      completedAppointmentServicesResult.data = fallbackCompletedAppointmentServicesResult.data as any;
      completedAppointmentServicesResult.error = null;
    }

    const completedServiceRelations = completedAppointmentServicesResult.data || [];
    const completedServiceIds = Array.from(
      new Set(completedServiceRelations.map((relation: any) => Number(relation.idServizio)).filter(Number.isFinite))
    );
    const soldServiceIds = Array.from(
      new Set(dettagliVenditaServizi.map((item: any) => Number(item.idServizio)).filter(Number.isFinite))
    );
    const reportServiceIds = Array.from(new Set([...completedServiceIds, ...soldServiceIds]));

    const serviziResult = reportServiceIds.length > 0
      ? await db
        .from("servizi")
        .select("idServizio, nome, categoria, sottocategoria, prezzo")
        .in("idServizio", reportServiceIds)
      : { data: [], error: null };

    if (serviziResult.error) {
      throw serviziResult.error;
    }

    const totalRevenue = vendite.reduce((sum: number, sale: any) => sum + Number(sale.totale || 0), 0);
    const totalSales = vendite.length;
    const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
    const totalProductsSold = dettagliVendita.reduce((sum: number, item: any) => sum + Number(item.quantita || 0), 0);
    const productRevenue = dettagliVendita.reduce(
      (sum: number, item: any) => sum + Number(item.quantita || 0) * Number(item.prezzoUnitario || 0),
      0
    );
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

    const operatorsById = new Map<number, any>();
    (operatoriResult.data || []).forEach((operator: any) => {
      operatorsById.set(Number(operator.idUtente), operator);
    });

    const servicesById = new Map<number, any>();
    (serviziResult.data || []).forEach((service: any) => {
      servicesById.set(Number(service.idServizio), service);
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

    const serviceRowsByAppointmentId = new Map<number, any[]>();
    completedServiceRelations.forEach((relation: any) => {
      const appointmentId = Number(relation.idAppuntamento);
      const service = servicesById.get(Number(relation.idServizio));
      if (!service) {
        return;
      }

      const current = serviceRowsByAppointmentId.get(appointmentId) || [];
      current.push({
        idServizio: Number(service.idServizio),
        nome: String(service.nome || "Servizio"),
        categoria: String(service.categoria || ""),
        sottocategoria: String(service.sottocategoria || ""),
        prezzo: relation.prezzoPersonalizzato != null
          ? Number(relation.prezzoPersonalizzato || 0)
          : Number(service.prezzo || 0)
      });
      serviceRowsByAppointmentId.set(appointmentId, current);
    });

    const customerSegmentById = new Map<number, "donna" | "uomo" | "bambino" | "non_classificato">();
    const segmentStats = new Map<string, { customers: Set<number>; appointments: number; revenue: number }>();
    const serviceStatsMap = new Map<string, { label: string; quantity: number; revenue: number }>();
    const dayStatsMap = new Map<string, { label: string; appointments: number; revenue: number; segments: Map<string, number> }>();
    const operatorStatsMap = new Map<number, { operatorId: number; name: string; tasks: number; revenue: number }>();
    const productStatsMap = new Map<number, { id: number; label: string; quantity: number; revenue: number }>();

    function ensureSegmentStats(label: string) {
      const current = segmentStats.get(label) || { customers: new Set<number>(), appointments: 0, revenue: 0 };
      segmentStats.set(label, current);
      return current;
    }

    completedAppointments.forEach((appointment: any) => {
      const appointmentId = Number(appointment.idAppuntamento);
      const customerId = Number(appointment.idCliente);
      const operatorId = Number(appointment.idOperatore);
      const services = serviceRowsByAppointmentId.get(appointmentId) || [];
      const revenue = services.reduce((sum, service) => sum + Number(service.prezzo || 0), 0);
      const detectedSegment = services
        .map((service) => resolveCustomerSegment(service))
        .find((segment) => segment !== "non_classificato")
        || customerSegmentById.get(customerId)
        || "non_classificato";

      if (Number.isFinite(customerId) && !customerSegmentById.has(customerId)) {
        customerSegmentById.set(customerId, detectedSegment);
      }

      const segmentEntry = ensureSegmentStats(detectedSegment);
      if (Number.isFinite(customerId)) {
        segmentEntry.customers.add(customerId);
      }
      segmentEntry.appointments += 1;
      segmentEntry.revenue += revenue;

      const appointmentDate = new Date(appointment.dataOraInizio);
      const weekdayLabel = appointmentDate.toLocaleDateString("it-IT", { weekday: "long" });
      const weekdayKey = normalizeKey(weekdayLabel);
      const dayEntry = dayStatsMap.get(weekdayKey) || {
        label: weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1),
        appointments: 0,
        revenue: 0,
        segments: new Map<string, number>()
      };
      dayEntry.appointments += 1;
      dayEntry.revenue += revenue;
      dayEntry.segments.set(detectedSegment, (dayEntry.segments.get(detectedSegment) || 0) + 1);
      dayStatsMap.set(weekdayKey, dayEntry);

      const operator = operatorsById.get(operatorId);
      const operatorEntry = operatorStatsMap.get(operatorId) || {
        operatorId,
        name: formatPersonName(operator, `Operatore #${operatorId}`),
        tasks: 0,
        revenue: 0
      };
      operatorEntry.tasks += services.length || 1;
      operatorEntry.revenue += revenue;
      operatorStatsMap.set(operatorId, operatorEntry);
    });

    dettagliVendita.forEach((item: any) => {
      const productId = Number(item.idProdotto);
      const quantity = Number(item.quantita || 0);
      const revenue = quantity * Number(item.prezzoUnitario || 0);
      const product = productsById.get(productId);
      const current = productStatsMap.get(productId) || {
        id: productId,
        label: String(product?.nome || `Prodotto #${productId}`),
        quantity: 0,
        revenue: 0
      };
      current.quantity += quantity;
      current.revenue += revenue;
      productStatsMap.set(productId, current);
    });

    dettagliVenditaServizi.forEach((item: any) => {
      const serviceId = Number(item.idServizio);
      const revenue = Number(item.prezzoUnitario || 0);
      const service = servicesById.get(serviceId);
      const key = normalizeKey(service?.nome) || `servizio-${serviceId}`;
      const current = serviceStatsMap.get(key) || {
        label: String(service?.nome || `Servizio #${serviceId}`),
        quantity: 0,
        revenue: 0
      };

      current.quantity += 1;
      current.revenue += revenue;
      serviceStatsMap.set(key, current);
    });

    const serviceRows = Array.from(serviceStatsMap.values())
      .map((item) => ({
        label: item.label,
        quantity: item.quantity,
        revenue: Number(item.revenue.toFixed(2))
      }))
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);
    const serviceRevenue = serviceRows.reduce((sum, item) => sum + item.revenue, 0);

    const ageRows = Array.from(customersById.values())
      .map((customer: any) => calculateAgeFromBirthDate(customer.data_nascita, now))
      .filter((age: number | null): age is number => age !== null);
    const averageAge = ageRows.length > 0
      ? Number((ageRows.reduce((sum, age) => sum + age, 0) / ageRows.length).toFixed(1))
      : 0;

    const ageRangeMap = new Map<string, number>();
    ageRows.forEach((age) => {
      const label = getAgeRangeLabel(age);
      ageRangeMap.set(label, (ageRangeMap.get(label) || 0) + 1);
    });

    const ageDistribution = Array.from(ageRangeMap.entries())
      .map(([label, count]) => ({
        label,
        count,
        percentage: ageRows.length > 0 ? Number(((count / ageRows.length) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "it"));

    const segmentLabels: Array<"donna" | "uomo" | "bambino"> = ["donna", "uomo", "bambino"];
    const segments = segmentLabels.map((segment) => {
      const entry = segmentStats.get(segment) || { customers: new Set<number>(), appointments: 0, revenue: 0 };
      return {
        label: segment,
        customers: entry.customers.size,
        appointments: entry.appointments,
        averageSpend: entry.appointments > 0 ? Number((entry.revenue / entry.appointments).toFixed(2)) : 0,
        revenue: Number(entry.revenue.toFixed(2))
      };
    });

    const totalSegmentCustomers = segments.reduce((sum, item) => sum + item.customers, 0);
    const classifiedCustomers = totalSegmentCustomers > 0 ? totalSegmentCustomers : customerFrequency.length;

    const busiestDays = Array.from(dayStatsMap.values())
      .map((day) => {
        const mainSegmentEntry = Array.from(day.segments.entries()).sort((a, b) => b[1] - a[1])[0];
        const mainSegment = mainSegmentEntry?.[0] || "non classificato";
        const mainSegmentCount = mainSegmentEntry?.[1] || 0;
        const mainSegmentPercentage = day.appointments > 0 ? Number(((mainSegmentCount / day.appointments) * 100).toFixed(1)) : 0;

        return {
          label: day.label,
          appointments: day.appointments,
          revenue: Number(day.revenue.toFixed(2)),
          drivingSegment: mainSegment,
          drivingSegmentCount: mainSegmentCount,
          drivingSegmentPercentage: mainSegmentPercentage
        };
      })
      .sort((a, b) => b.appointments - a.appointments || b.revenue - a.revenue)
      .slice(0, 7);

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
        frequency: customerFrequency,
        total: customerFrequency.length,
        classifiedTotal: classifiedCustomers,
        segments,
        averageAge,
        ageDistribution
      },
      services: {
        revenue: Number(serviceRevenue.toFixed(2)),
        percentageOnSales: totalRevenue > 0 ? Number(((serviceRevenue / totalRevenue) * 100).toFixed(1)) : 0,
        byType: serviceRows
      },
      traffic: {
        busiestDays
      },
      operators: {
        performance: Array.from(operatorStatsMap.values())
          .map((item) => ({
            operatorId: item.operatorId,
            name: item.name,
            tasks: item.tasks,
            revenue: Number(item.revenue.toFixed(2))
          }))
          .sort((a, b) => b.revenue - a.revenue || b.tasks - a.tasks)
      },
      retail: {
        revenue: Number(productRevenue.toFixed(2)),
        percentageOnSales: totalRevenue > 0 ? Number(((productRevenue / totalRevenue) * 100).toFixed(1)) : 0,
        topProducts: Array.from(productStatsMap.values())
          .map((item) => ({
            id: item.id,
            label: item.label,
            quantity: item.quantity,
            revenue: Number(item.revenue.toFixed(2)),
            percentage: productRevenue > 0 ? Number(((item.revenue / productRevenue) * 100).toFixed(1)) : 0
          }))
          .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
      }
    });
  } catch (err: any) {
    console.error("Errore GET /dashboard/report:", err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
