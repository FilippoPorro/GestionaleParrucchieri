import express, { Request, Response } from "express";
import { db } from "../db_parrucchieri";

const router = express.Router();

const servizioColumns = "idServizio,nome,descrizione,durata,prezzo,categoria,sottocategoria,tipoPrenotazione,visualizzazioneSito";

function isVisibleOnSite(record: any): boolean {
  const value =
    record?.["visualizzazione sito"] ??
    record?.visualizzazioneSito ??
    record?.visualizzazione_sito ??
    record?.visualizzazione;

  return value === true || value === 1 || value === "true" || value === "t";
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const idOperatoreParam = req.query.idOperatore as string | undefined;

    if (!idOperatoreParam) {
      const { data, error } = await db
        .from("servizi")
        .select(servizioColumns)
        .order("nome", { ascending: true });

      if (error) {
        throw error;
      }

      const showAll = req.query.all === "true";
      if (showAll) {
        return res.json(data || []);
      }

      return res.json((data || []).filter(isVisibleOnSite));
    }

    const idOperatore = Number(idOperatoreParam);

    if (!Number.isFinite(idOperatore) || idOperatore <= 0) {
      return res.status(400).json({ message: "idOperatore non valido" });
    }

    const { data: serviziOperatore, error: serviziOperatoreError } = await db
      .from("serviziOperatori")
      .select("idServizio")
      .eq("idOperatore", idOperatore);

    if (serviziOperatoreError) {
      throw serviziOperatoreError;
    }

    const serviceIds = (serviziOperatore || [])
      .map((record: { idServizio: number | null }) => Number(record.idServizio))
      .filter((id) => Number.isFinite(id));

    if (!serviceIds.length) {
      return res.json([]);
    }

    const { data: servizi, error: serviziError } = await db
      .from("servizi")
      .select(servizioColumns)
      .eq("visualizzazioneSito", true)
      .eq("tipoPrenotazione", "sito")
      .in("idServizio", serviceIds)
      .order("nome", { ascending: true });

    if (serviziError) {
      throw serviziError;
    }

    return res.json(servizi || []);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Errore server" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { nome, descrizione, durata, prezzo, categoria, sottocategoria, tipoPrenotazione, visualizzazioneSito } = req.body;

    if (!nome || prezzo === undefined) {
      return res.status(400).json({ message: "Nome e prezzo sono obbligatori" });
    }

    const { data, error } = await db
      .from("servizi")
      .insert({
        nome,
        descrizione: descrizione || null,
        durata: durata !== undefined && durata !== null ? Number(durata) : null,
        prezzo: Number(prezzo),
        categoria: categoria || "",
        sottocategoria: sottocategoria || "",
        tipoPrenotazione: tipoPrenotazione || "sito",
        visualizzazioneSito: visualizzazioneSito !== undefined ? !!visualizzazioneSito : true
      })
      .select(servizioColumns)
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json(data);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Errore server" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const idServizio = Number(req.params.id);
    if (!Number.isFinite(idServizio) || idServizio <= 0) {
      return res.status(400).json({ message: "idServizio non valido" });
    }

    const { nome, descrizione, durata, prezzo, categoria, sottocategoria, tipoPrenotazione, visualizzazioneSito } = req.body;

    if (!nome || prezzo === undefined) {
      return res.status(400).json({ message: "Nome e prezzo sono obbligatori" });
    }

    const { data, error } = await db
      .from("servizi")
      .update({
        nome,
        descrizione: descrizione || null,
        durata: durata !== undefined && durata !== null ? Number(durata) : null,
        prezzo: Number(prezzo),
        categoria: categoria || "",
        sottocategoria: sottocategoria || "",
        tipoPrenotazione: tipoPrenotazione || "sito",
        visualizzazioneSito: visualizzazioneSito !== undefined ? !!visualizzazioneSito : true
      })
      .eq("idServizio", idServizio)
      .select(servizioColumns)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ message: "Servizio non trovato" });
    }

    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Errore server" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const idServizio = Number(req.params.id);
    if (!Number.isFinite(idServizio) || idServizio <= 0) {
      return res.status(400).json({ message: "idServizio non valido" });
    }

    const { data, error } = await db
      .from("servizi")
      .delete()
      .eq("idServizio", idServizio)
      .select("idServizio")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ message: "Servizio non trovato" });
    }

    return res.json({ message: "Servizio eliminato con successo" });
  } catch (err: any) {
    return res.status(500).json({ message: err.message || "Errore server" });
  }
});

export default router;
