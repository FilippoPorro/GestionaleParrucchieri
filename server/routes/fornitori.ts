import express, { Request, Response } from "express";
import { db } from "../db_parrucchieri";

interface Fornitore {
  idFornitore: number;
  nome: string;
  telefono: string | null;
  email: string | null;
  partitaIva: string | null;
}

const router = express.Router();

function normalizeFornitoreRow(row: any): Fornitore | null {
  const idFornitore = Number(row?.idFornitore ?? row?.id ?? 0);

  if (!Number.isFinite(idFornitore) || idFornitore <= 0) {
    return null;
  }

  return {
    idFornitore,
    nome: String(row?.nome ?? "").trim(),
    telefono: row?.telefono != null ? String(row.telefono).trim() : null,
    email: row?.email != null ? String(row.email).trim() : null,
    partitaIva: row?.partitaIva != null ? String(row.partitaIva).trim() : null
  };
}

function sortFornitori(fornitori: Fornitore[]): Fornitore[] {
  return [...fornitori].sort((a, b) =>
    a.nome.localeCompare(b.nome, "it", { sensitivity: "base" })
  );
}

function buildFornitorePayload(body: any) {
  return {
    nome: String(body?.nome ?? "").trim(),
    telefono: String(body?.telefono ?? "").trim() || null,
    email: String(body?.email ?? "").trim().toLowerCase() || null,
    partitaIva: String(body?.partitaIva ?? "").trim() || null
  };
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await db
      .from("fornitori")
      .select("*")
      .order("nome", { ascending: true });

    if (error) {
      throw error;
    }

    const fornitori = sortFornitori(
      (data || [])
        .map((row: any) => normalizeFornitoreRow(row))
        .filter((row: Fornitore | null): row is Fornitore => row !== null)
    );

    return res.json({ fornitori });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const payload = buildFornitorePayload(req.body);

    if (!payload.nome) {
      return res.status(400).json({ message: "Il nome del fornitore e obbligatorio" });
    }

    const { data, error } = await db
      .from("fornitori")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    const fornitore = normalizeFornitoreRow(data);

    if (!fornitore) {
      return res.status(500).json({ message: "Fornitore creato ma non leggibile" });
    }

    return res.status(201).json(fornitore);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const idFornitore = Number(req.params.id);
    const payload = buildFornitorePayload(req.body);

    if (!Number.isFinite(idFornitore) || idFornitore <= 0) {
      return res.status(400).json({ message: "Fornitore non valido" });
    }

    if (!payload.nome) {
      return res.status(400).json({ message: "Il nome del fornitore e obbligatorio" });
    }

    const { data, error } = await db
      .from("fornitori")
      .update(payload)
      .eq("idFornitore", idFornitore)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    const fornitore = normalizeFornitoreRow(data);

    if (!fornitore) {
      return res.status(404).json({ message: "Fornitore non trovato" });
    }

    return res.json(fornitore);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const idFornitore = Number(req.params.id);

    if (!Number.isFinite(idFornitore) || idFornitore <= 0) {
      return res.status(400).json({ message: "Fornitore non valido" });
    }

    const { data, error } = await db
      .from("fornitori")
      .delete()
      .eq("idFornitore", idFornitore)
      .select("idFornitore")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ message: "Fornitore non trovato" });
    }

    return res.json({ message: "Fornitore eliminato con successo" });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
