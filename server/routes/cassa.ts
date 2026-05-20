import { Router, Request, Response } from "express";
import { db } from "../db_parrucchieri";

const router = Router();

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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

// POST /api/cassa/registra
router.post("/registra", async (req: Request, res: Response) => {
  try {
    const { idCliente, idOperatore, totale, metodo, prodotti } = req.body;

    if (totale === undefined || totale === null || Number(totale) < 0) {
      return res.status(400).json({ message: "Totale non valido" });
    }

    if (!metodo || !["contanti", "carta"].includes(metodo)) {
      return res.status(400).json({ message: "Metodo di pagamento non valido. Scegli 'carta' o 'contanti'." });
    }

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

    const idVendita = (venditaData as any).idVendita;

    // 2. Inserimento del pagamento associato alla vendita
    const { error: pagamentoError } = await db
      .from("pagamenti")
      .insert({
        idVendita: idVendita,
        metodo: metodo,
        importo: Number(totale),
        data: new Date().toISOString()
      });

    if (pagamentoError) {
      throw pagamentoError;
    }

    // 3. Gestione prodotti venduti (dettagliovendita e decremento magazzino)
    if (Array.isArray(prodotti) && prodotti.length > 0) {
      for (const item of prodotti) {
        const idProdotto = Number(item.idProdotto ?? item.id);
        const quantita = Number(item.quantita ?? 1);
        const prezzoUnitario = Number(item.prezzoUnitario ?? item.prezzoRivendita ?? item.prezzo ?? 0);

        if (!Number.isNaN(idProdotto) && idProdotto > 0 && quantita > 0) {
          // Inserimento riga di dettaglio
          const { error: dettaglioError } = await db
            .from("dettagliovendita")
            .insert({
              idVendita,
              idProdotto,
              quantita,
              prezzoUnitario
            });

          if (dettaglioError) {
            throw dettaglioError;
          }

          // Decremento dello stock in prodotti
          const { data: prodData, error: prodError } = await db
            .from("prodotti")
            .select("quantitaMagazzino")
            .eq("idProdotto", idProdotto)
            .single();

          if (!prodError && prodData) {
            const currentStock = Number((prodData as any).quantitaMagazzino ?? 0);
            const newStock = Math.max(0, currentStock - quantita);

            await db
              .from("prodotti")
              .update({ quantitaMagazzino: newStock })
              .eq("idProdotto", idProdotto);
          }
        }
      }
    }

    return res.status(201).json({
      message: "Pagamento registrato con successo",
      idVendita
    });
  } catch (err: any) {
    console.error("Errore POST /api/cassa/registra:", err);
    return res.status(500).json({ message: err.message });
  }
});

export default router;
