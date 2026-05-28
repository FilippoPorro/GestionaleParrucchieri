import { Router, Request, Response } from "express";
import { db } from "../db_parrucchieri";

const router = Router();

type NormalizedCassaProduct = {
  productId: number;
  qty: number;
  prezzoUnitario: number;
};

type NormalizedCassaService = {
  serviceId: number;
  prezzoUnitario: number;
};

function normalizeCassaProducts(prodotti: any[]): NormalizedCassaProduct[] {
  const byProduct = new Map<number, NormalizedCassaProduct>();

  for (const item of prodotti) {
    const productId = Number(item.idProdotto ?? item.id);
    const qty = Number(item.quantita || 1);
    const prezzoUnitario = Number(item.prezzoUnitario ?? item.prezzoRivendita ?? item.prezzo ?? 0);

    if (!Number.isFinite(productId) || !Number.isFinite(qty) || qty <= 0) {
      throw new Error("Prodotto o quantita non validi");
    }

    const existing = byProduct.get(productId);

    if (existing) {
      existing.qty += qty;
      continue;
    }

    byProduct.set(productId, {
      productId,
      qty,
      prezzoUnitario: Number.isFinite(prezzoUnitario) ? prezzoUnitario : 0
    });
  }

  return [...byProduct.values()];
}

function normalizeCassaServices(servizi: any[]): NormalizedCassaService[] {
  const byService = new Map<number, NormalizedCassaService>();

  for (const item of servizi) {
    const serviceId = Number(item.idServizio ?? item.id);
    const prezzoUnitario = Number(item.prezzoUnitario ?? item.prezzo ?? 0);

    if (!Number.isFinite(serviceId) || serviceId <= 0) {
      throw new Error("Servizio non valido");
    }

    byService.set(serviceId, {
      serviceId,
      prezzoUnitario: Number.isFinite(prezzoUnitario) ? prezzoUnitario : 0
    });
  }

  return [...byService.values()];
}

function getErrorCode(error: unknown): string {
  return typeof (error as any)?.code === "string" ? (error as any).code : "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof (error as any)?.message === "string"
      ? (error as any).message
      : "";
}

function isStockError(error: unknown): boolean {
  return /stock[_ ]insufficiente/i.test(getErrorMessage(error));
}

function isMissingManagementCheckoutRpcError(error: unknown): boolean {
  return getErrorCode(error) === "PGRST202" && /complete_management_checkout_sicuro/i.test(getErrorMessage(error));
}

function isInvalidTotalError(error: unknown): boolean {
  return /invalid_total|totale non coerente/i.test(getErrorMessage(error));
}

function isInvalidPaymentMethodError(error: unknown): boolean {
  return /invalid_payment_method/i.test(getErrorMessage(error));
}

function isInvalidAppointmentError(error: unknown): boolean {
  return /appointment_not_found/i.test(getErrorMessage(error));
}

function isInvalidOperatorError(error: unknown): boolean {
  return /operator_required|operator_not_found/i.test(getErrorMessage(error));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function calculateExpectedTotal(
  prodottiVenduti: NormalizedCassaProduct[],
  serviziVenduti: NormalizedCassaService[]
): number {
  const prodottiTotal = prodottiVenduti.reduce(
    (sum, item) => sum + item.qty * item.prezzoUnitario,
    0
  );
  const serviziTotal = serviziVenduti.reduce(
    (sum, item) => sum + item.prezzoUnitario,
    0
  );

  return roundCurrency(prodottiTotal + serviziTotal);
}

function serializeCheckoutProducts(prodottiVenduti: NormalizedCassaProduct[]) {
  return prodottiVenduti.map((item) => ({
    productId: item.productId,
    qty: item.qty,
    prezzoUnitario: item.prezzoUnitario
  }));
}

function serializeCheckoutServices(serviziVenduti: NormalizedCassaService[]) {
  return serviziVenduti.map((item) => ({
    serviceId: item.serviceId,
    prezzoUnitario: item.prezzoUnitario
  }));
}

async function completeManagementCheckout(
  idCliente: number | null,
  idOperatore: number | null,
  idAppuntamento: number | null,
  metodoPagamento: "contanti" | "carta",
  totale: number,
  prodottiVenduti: NormalizedCassaProduct[],
  serviziVenduti: NormalizedCassaService[]
): Promise<number> {
  const { data, error } = await db
    .rpc("complete_management_checkout_sicuro", {
      p_id_cliente: idCliente,
      p_id_operatore: idOperatore,
      p_id_appuntamento: idAppuntamento,
      p_metodo: metodoPagamento,
      p_total: totale,
      p_product_items: serializeCheckoutProducts(prodottiVenduti),
      p_service_items: serializeCheckoutServices(serviziVenduti)
    })
    .single();

  if (error) {
    throw error;
  }

  const idVendita = Number((data as any)?.idVendita);

  if (!Number.isFinite(idVendita) || idVendita <= 0) {
    throw new Error("checkout_result_invalid");
  }

  return idVendita;
}

function normalizeMetodoPagamento(metodo: unknown): "contanti" | "carta" | null {
  const value = String(metodo || "").trim().toLowerCase();

  if (value === "contanti") {
    return "contanti";
  }

  if (value === "pos" || value === "carta") {
    return "carta";
  }

  return null;
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

function formatCustomerName(cliente: any): string {
  const fullName = `${cliente?.cognome || ""} ${cliente?.nome || ""}`.trim();
  return !fullName || normalizeKey(fullName) === "utente utente"
    ? "Cliente generico"
    : fullName;
}

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

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = formatLocalDate(now);
    const startOfDay = `${today}T00:00:00`;
    const endOfDay = `${today}T23:59:59`;

    const [pagamentiResult, venditeResult] = await Promise.all([
      db
        .from("pagamenti")
        .select("importo")
        .gte("data", startOfDay)
        .lte("data", endOfDay),
      db
        .from("vendite")
        .select("idVendita", { count: "exact", head: true })
        .gte("data", startOfDay)
        .lte("data", endOfDay)
    ]);

    if (pagamentiResult.error) {
      throw pagamentiResult.error;
    }

    if (venditeResult.error) {
      throw venditeResult.error;
    }

    const incassoOggi = (pagamentiResult.data || []).reduce(
      (sum: number, p: any) => sum + Number(p.importo || 0),
      0
    );

    return res.json({
      incassoOggi,
      scontriniOggi: venditeResult.count ?? 0
    });
  } catch (err: any) {
    console.error("Errore GET /api/cassa/stats:", err);
    return res.status(500).json({ message: err.message });
  }
});

router.get("/appuntamenti-da-incassare", async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    const { data: appointmentsData, error: appointmentsError } = await db
      .from("appuntamenti")
      .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
      .lte("dataOraInizio", formatLocalDateTime(now))
      .not("idCliente", "is", null)
      .order("dataOraInizio", { ascending: true });

    if (appointmentsError) {
      throw appointmentsError;
    }

    const appointments = (appointmentsData || []).filter((appointment: any) => {
      const stato = String(appointment.stato || "prenotato").toLowerCase();
      return stato !== "completato";
    });

    const appointmentIds = appointments
      .map((appointment: any) => Number(appointment.idAppuntamento))
      .filter(Number.isFinite);

    if (appointmentIds.length === 0) {
      return res.json({ appuntamenti: [] });
    }

    const clienteIds = Array.from(new Set(appointments.map((appointment: any) => Number(appointment.idCliente)).filter(Number.isFinite)));
    const operatoreIds = Array.from(new Set(appointments.map((appointment: any) => Number(appointment.idOperatore)).filter(Number.isFinite)));

    const [relationsResult, clientiResult, operatoriResult] = await Promise.all([
      db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio, prezzoPersonalizzato, durataPersonalizzata")
        .in("idAppuntamento", appointmentIds),
      db
        .from("utenti")
        .select("idUtente, nome, cognome, email")
        .in("idUtente", clienteIds),
      db
        .from("utenti")
        .select("idUtente, nome, cognome")
        .in("idUtente", operatoreIds)
    ]);

    if (relationsResult.error) {
      if (!String(relationsResult.error.message || "").toLowerCase().includes("prezzopersonalizzato")) {
        throw relationsResult.error;
      }

      const fallbackRelationsResult = await db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio")
        .in("idAppuntamento", appointmentIds);

      if (fallbackRelationsResult.error) {
        throw fallbackRelationsResult.error;
      }

      relationsResult.data = fallbackRelationsResult.data as any;
      relationsResult.error = null;
    }

    if (clientiResult.error) {
      throw clientiResult.error;
    }

    if (operatoriResult.error) {
      throw operatoriResult.error;
    }

    const serviceIds = Array.from(
      new Set((relationsResult.data || []).map((relation: any) => Number(relation.idServizio)).filter(Number.isFinite))
    );

    const servicesResult = serviceIds.length > 0
      ? await db
        .from("servizi")
        .select("idServizio, nome, prezzo")
        .in("idServizio", serviceIds)
      : { data: [], error: null };

    if (servicesResult.error) {
      throw servicesResult.error;
    }

    const clientiById = new Map<number, any>();
    (clientiResult.data || []).forEach((cliente: any) => {
      clientiById.set(Number(cliente.idUtente), cliente);
    });

    const operatoriById = new Map<number, any>();
    (operatoriResult.data || []).forEach((operatore: any) => {
      operatoriById.set(Number(operatore.idUtente), operatore);
    });

    const servicesById = new Map<number, any>();
    (servicesResult.data || []).forEach((service: any) => {
      servicesById.set(Number(service.idServizio), service);
    });

    const servicesByAppointmentId = new Map<number, any[]>();
    (relationsResult.data || []).forEach((relation: any) => {
      const appointmentId = Number(relation.idAppuntamento);
      const service = servicesById.get(Number(relation.idServizio));

      if (!service) {
        return;
      }

      const current = servicesByAppointmentId.get(appointmentId) || [];
      current.push({
        idServizio: Number(service.idServizio),
        nome: String(service.nome || "Servizio"),
        prezzo: relation.prezzoPersonalizzato != null
          ? Number(relation.prezzoPersonalizzato || 0)
          : Number(service.prezzo || 0)
      });
      servicesByAppointmentId.set(appointmentId, current);
    });

    const appuntamenti = appointments.map((appointment: any) => {
      const cliente = clientiById.get(Number(appointment.idCliente));
      const operatore = operatoriById.get(Number(appointment.idOperatore));
      const servizi = servicesByAppointmentId.get(Number(appointment.idAppuntamento)) || [];

      return {
        ...appointment,
        clienteNome: formatCustomerName(cliente),
        clienteEmail: cliente ? String(cliente.email || "") : "",
        operatoreNome: operatore ? `${operatore.cognome || ""} ${operatore.nome || ""}`.trim() : "Operatore",
        servizi,
        totalePrevisto: servizi.reduce((totale, servizio) => totale + Number(servizio.prezzo || 0), 0)
      };
    });

    return res.json({ appuntamenti });
  } catch (err: any) {
    console.error("Errore GET /api/cassa/appuntamenti-da-incassare:", err);
    return res.status(500).json({ message: err.message });
  }
});

router.post("/registra", async (req: Request, res: Response) => {
  try {
    const { idCliente, idOperatore, idAppuntamento, totale, metodo, prodotti, servizi } = req.body;

    if (totale === undefined || totale === null || Number(totale) < 0) {
      return res.status(400).json({ message: "Totale non valido" });
    }

    const metodoPagamento = normalizeMetodoPagamento(metodo);

    if (!metodoPagamento) {
      return res.status(400).json({ message: "Metodo di pagamento non valido. Scegli 'pos' o 'contanti'." });
    }

    const prodottiVenduti = normalizeCassaProducts(Array.isArray(prodotti) ? prodotti : []);
    const serviziVenduti = normalizeCassaServices(Array.isArray(servizi) ? servizi : []);
    const expectedTotal = calculateExpectedTotal(prodottiVenduti, serviziVenduti);
    const receivedTotal = roundCurrency(Number(totale));

    if (expectedTotal !== receivedTotal) {
      return res.status(400).json({
        message: "Totale non coerente con prodotti e servizi",
        expectedTotal,
        receivedTotal
      });
    }

    const normalizedCustomerId = idCliente ? Number(idCliente) : -1;
    const normalizedOperatorId = idOperatore ? Number(idOperatore) : null;
    const normalizedAppointmentId = idAppuntamento ? Number(idAppuntamento) : null;

    if (serviziVenduti.length > 0 && (!Number.isFinite(normalizedOperatorId) || (normalizedOperatorId ?? 0) <= 0)) {
      return res.status(400).json({
        message: "Operatore obbligatorio per registrare servizi"
      });
    }

    let idVendita: number;

    try {
      idVendita = await completeManagementCheckout(
        normalizedCustomerId,
        normalizedOperatorId,
        normalizedAppointmentId,
        metodoPagamento,
        receivedTotal,
        prodottiVenduti,
        serviziVenduti
      );
    } catch (error) {
      if (isMissingManagementCheckoutRpcError(error)) {
        return res.status(500).json({
          message: "Manca la funzione SQL del nuovo checkout gestionale. Applica prima la migration nel DB.",
          error: getErrorMessage(error)
        });
      }

      throw error;
    }

    return res.status(201).json({
      message: "Pagamento registrato con successo",
      idVendita
    });
  } catch (err: any) {
    console.error("Errore POST /api/cassa/registra:", err);
    const statusCode = isStockError(err)
      ? 409
      : isInvalidTotalError(err) || isInvalidPaymentMethodError(err) || isInvalidAppointmentError(err) || isInvalidOperatorError(err)
        ? 400
        : 500;

    return res.status(statusCode).json({
      message: "Errore durante il salvataggio della vendita",
      error: err.message
    });
  }
});

export default router;
