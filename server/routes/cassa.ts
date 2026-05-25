import { Router, Request, Response } from "express";
import { db } from "../db_parrucchieri";

const router = Router();

type NormalizedCassaProduct = {
  productId: number;
  qty: number;
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

function isStockError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as any)?.message === "string"
        ? (error as any).message
        : "";

  return /stock[_ ]insufficiente/i.test(message);
}

function isMissingCheckoutRpcError(error: unknown): boolean {
  const code = typeof (error as any)?.code === "string" ? (error as any).code : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as any)?.message === "string"
        ? (error as any).message
        : "";

  return code === "PGRST202" && /complete_checkout_sicuro/i.test(message);
}

async function completeCheckoutWithFallback(
  idCliente: number | null,
  totale: number,
  prodottiVenduti: NormalizedCassaProduct[]
): Promise<number> {
  const productIds = prodottiVenduti.map((item) => item.productId);

  const { data: stockRows, error: stockReadError } = await db
    .from("prodotti")
    .select("idProdotto, quantitaMagazzino")
    .in("idProdotto", productIds);

  if (stockReadError) throw stockReadError;

  const stockByProductId = new Map<number, number>();

  (stockRows || []).forEach((row: any) => {
    stockByProductId.set(Number(row.idProdotto), Number(row.quantitaMagazzino || 0));
  });

  for (const item of prodottiVenduti) {
    const availableStock = stockByProductId.get(item.productId);

    if (availableStock === undefined) {
      throw new Error("product_not_found");
    }

    if (availableStock < item.qty) {
      throw new Error("stock_insufficiente");
    }
  }

  const { data: venditaData, error: venditaError } = await db
    .from("vendite")
    .insert({
      idCliente,
      totale,
      data: new Date().toISOString()
    })
    .select("idVendita")
    .single();

  if (venditaError) throw venditaError;

  const idVendita = Number((venditaData as any).idVendita);

  for (const item of prodottiVenduti) {
    const currentStock = stockByProductId.get(item.productId) ?? 0;

    const { data: updatedProduct, error: updateError } = await db
      .from("prodotti")
      .update({
        quantitaMagazzino: currentStock - item.qty
      })
      .eq("idProdotto", item.productId)
      .gte("quantitaMagazzino", item.qty)
      .select("idProdotto")
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updatedProduct) {
      throw new Error("stock_insufficiente");
    }
  }

  const dettagliVendita = prodottiVenduti.map((item) => ({
    idVendita,
    idProdotto: item.productId,
    quantita: item.qty,
    prezzoUnitario: item.prezzoUnitario
  }));

  const { error: dettagliError } = await db
    .from("dettagliovendita")
    .insert(dettagliVendita);

  if (dettagliError) throw dettagliError;

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

// GET /api/cassa/stats
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

// GET /api/cassa/appuntamenti-da-incassare
router.get("/appuntamenti-da-incassare", async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = formatLocalDate(now);
    const startOfDay = `${today}T00:00:00`;

    const { data: appointmentsData, error: appointmentsError } = await db
      .from("appuntamenti")
      .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
      .gte("dataOraInizio", startOfDay)
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

    const [
      relationsResult,
      clientiResult,
      operatoriResult
    ] = await Promise.all([
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
        clienteNome: cliente ? `${cliente.cognome || ""} ${cliente.nome || ""}`.trim() : "Cliente",
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

// POST /api/cassa/registra
router.post("/registra", async (req: Request, res: Response) => {
  try {
    const { idCliente, idOperatore, idAppuntamento, totale, metodo, prodotti } = req.body;

    if (totale === undefined || totale === null || Number(totale) < 0) {
      return res.status(400).json({ message: "Totale non valido" });
    }

    const metodoPagamento = normalizeMetodoPagamento(metodo);

    if (!metodoPagamento) {
      return res.status(400).json({ message: "Metodo di pagamento non valido. Scegli 'pos' o 'contanti'." });
    }

    const prodottiVenduti = normalizeCassaProducts(Array.isArray(prodotti) ? prodotti : []);
    const hasProdottiVenduti = prodottiVenduti.length > 0;

    let idVendita: number;

    if (hasProdottiVenduti) {
      // Quando la vendita da gestionale include prodotti, passiamo dalla RPC
      // così vengono aggiornati stock, vendite e dettagliovendita.
      const { data: checkoutData, error: checkoutError } = await db
        .rpc("complete_checkout_sicuro", {
          p_id_cliente: idCliente ? Number(idCliente) : null,
          p_total: Number(totale),
          p_items: prodottiVenduti
        })
        .single();

      if (checkoutError && !isMissingCheckoutRpcError(checkoutError)) {
        throw checkoutError;
      }

      idVendita = checkoutError
        ? await completeCheckoutWithFallback(
          idCliente ? Number(idCliente) : null,
          Number(totale),
          prodottiVenduti
        )
        : Number((checkoutData as any)?.idVendita);

      if (!Number.isFinite(idVendita) || idVendita <= 0) {
        throw new Error("checkout_result_invalid");
      }
    } else {
      // Se ci sono solo servizi, registriamo la vendita senza righe prodotto.
      // 1. Inserimento della vendita
      const { data: venditaData, error: venditaError } = await db
        .from("vendite")
        .insert({
          idCliente: idCliente ? Number(idCliente) : null,
          totale: Number(totale),
          data: new Date().toISOString()
        })
        .select("idVendita")
        .single();

      if (venditaError) {
        throw venditaError;
      }

      idVendita = Number((venditaData as any).idVendita);
    }

    // 2. Inserimento del pagamento associato alla vendita
    const { error: pagamentoError } = await db
      .from("pagamenti")
      .insert({
        idVendita: idVendita,
        metodo: metodoPagamento,
        importo: Number(totale),
        data: new Date().toISOString()
      });

    if (pagamentoError) {
      throw pagamentoError;
    }

    if (idAppuntamento) {
      const { error: appointmentUpdateError } = await db
        .from("appuntamenti")
        .update({ stato: "completato" })
        .eq("idAppuntamento", Number(idAppuntamento));

      if (appointmentUpdateError) {
        throw appointmentUpdateError;
      }
    }

    return res.status(201).json({
      message: "Pagamento registrato con successo",
      idVendita
    });
  } catch (err: any) {
    console.error("Errore POST /api/cassa/registra:", err);
    return res.status(isStockError(err) ? 409 : 500).json({
      message: "Errore durante il salvataggio della vendita",
      error: err.message
    });
  }
});

export default router;
