import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "../db_parrucchieri";
import { sendManagedClientPasswordEmail } from "../services/managed-client-email";
import { sendMailInBackground } from "../services/mail-utils";

interface Utente {
  idUtente: number;
  nome: string;
  cognome: string;
  email: string;
  telefono: string | null;
  data_nascita: string | null;
  sesso: "m" | "f" | null;
  ruolo: string;
  photoURL?: string | null;
  mustChangePassword?: boolean;
}

function normalizeSesso(value: unknown): "m" | "f" | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "m" || normalized === "maschio" || normalized === "mascio") {
    return "m";
  }

  if (normalized === "f" || normalized === "femmina") {
    return "f";
  }

  return null;
}

type ClienteSource = "clienti" | "utenti";
type ClienteLookup = {
  source: ClienteSource;
  idColumn?: string;
  row?: any;
};

const router = express.Router();
const MANAGED_CLIENT_RESET_TTL_MS = 10 * 60 * 1000;

function normalizeClienteRow(row: any, source: ClienteSource): Utente | null {
  const idUtente = Number(
    row?.idUtente ??
    row?.idCliente ??
    row?.id ??
    0
  );

  if (!Number.isFinite(idUtente) || idUtente <= 0) {
    return null;
  }

  return {
    idUtente,
    nome: String(row?.nome ?? "").trim(),
    cognome: String(row?.cognome ?? "").trim(),
    email: String(row?.email ?? "").trim(),
    telefono: row?.telefono != null ? String(row.telefono).trim() : null,
    data_nascita: row?.data_nascita != null ? String(row.data_nascita).trim() : null,
    sesso: normalizeSesso(row?.sesso),
    ruolo: source === "clienti"
      ? "cliente"
      : String(row?.ruolo ?? "cliente").trim() || "cliente",
    photoURL: row?.photoURL ?? row?.picture ?? row?.avatar_url ?? row?.avatar ?? null,
    mustChangePassword: !!row?.mustChangePassword
  };
}

function generateTemporaryPassword(): string {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

function buildResetLink(resetToken: string): string {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4200";
  return `${frontendUrl.replace(/\/$/, "")}/reset-password?token=${resetToken}`;
}

function sortClienti(clienti: Utente[]): Utente[] {
  return [...clienti].sort((a, b) => {
    const cognomeCompare = a.cognome.localeCompare(b.cognome, "it", { sensitivity: "base" });
    if (cognomeCompare !== 0) {
      return cognomeCompare;
    }

    return a.nome.localeCompare(b.nome, "it", { sensitivity: "base" });
  });
}

function isMissingTableError(error: any): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const hint = String(error?.hint ?? "").toLowerCase();
  const combined = `${message} ${details} ${hint}`;

  return combined.includes("relation") ||
    combined.includes("does not exist") ||
    combined.includes("not found") ||
    combined.includes("schema cache");
}

function isMissingManagedPasswordColumnError(error: any): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  const details = String(error?.details ?? "").toLowerCase();
  const hint = String(error?.hint ?? "").toLowerCase();
  const combined = `${message} ${details} ${hint}`;

  return (combined.includes("mustchangepassword") ||
    combined.includes("resetpasswordtoken") ||
    combined.includes("resetpasswordexpires")) &&
    (combined.includes("column") || combined.includes("schema cache"));
}

async function getClientiFromClientiTable(): Promise<Utente[]> {
  const { data, error } = await db
    .from("clienti")
    .select("*");

  if (error) {
    throw error;
  }

  return sortClienti(
    (data || [])
      .map((row: any) => normalizeClienteRow(row, "clienti"))
      .filter((row: Utente | null): row is Utente => row !== null)
  );
}

async function getClientiFromUtentiTable(): Promise<Utente[]> {
  const { data, error } = await db
    .from("utenti")
    .select("*")
    .order("cognome", { ascending: true })
    .order("nome", { ascending: true });

  if (error) {
    throw error;
  }

  const clienti = (data || [])
    .map((row: any) => normalizeClienteRow(row, "utenti"))
    .filter((row: Utente | null): row is Utente => row !== null)
    .filter((row) => !["operatore", "titolare", "salone"].includes(String(row.ruolo || "").toLowerCase()));

  return sortClienti(clienti);
}

async function getClientiWithSource(): Promise<{ clienti: Utente[]; source: ClienteSource }> {
  let clientiTableRows: Utente[] = [];

  try {
    clientiTableRows = await getClientiFromClientiTable();
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn("Lettura tabella clienti fallita, provo fallback su utenti:", error);
    }
  }

  const utentiRows = await getClientiFromUtentiTable();

  if (clientiTableRows.length === 0) {
    return { clienti: utentiRows, source: "utenti" };
  }

  const clientiById = new Map<number, Utente>();

  for (const cliente of [...clientiTableRows, ...utentiRows]) {
    clientiById.set(cliente.idUtente, cliente);
  }

  return { clienti: sortClienti([...clientiById.values()]), source: "clienti" };
}

async function findClienteInClientiTable(id: number): Promise<{ idColumn: string; row: any } | null> {
  const candidateIdColumns = ["idUtente", "idCliente", "id"];

  for (const idColumn of candidateIdColumns) {
    try {
      const { data, error } = await db
        .from("clienti")
        .select("*")
        .eq(idColumn, id)
        .limit(1);

      if (!error && Array.isArray(data) && data.length > 0) {
        return { idColumn, row: data[0] };
      }
    } catch {
      // Prova la colonna successiva: i database usati nel progetto non hanno tutti la stessa anagrafica clienti.
    }
  }

  return null;
}

async function getClientLookupById(id: number): Promise<ClienteLookup> {
  const clienteTableMatch = await findClienteInClientiTable(id);

  if (clienteTableMatch) {
    return {
      source: "clienti",
      idColumn: clienteTableMatch.idColumn,
      row: clienteTableMatch.row
    };
  }

  return { source: "utenti" };
}

function buildClientiUpdatePayload(row: any, values: {
  nome: string;
  cognome: string;
  email: string;
  telefono: string;
  data_nascita: string;
  sesso: "m" | "f";
}) {
  const payload: Record<string, string | null> = {
    nome: values.nome,
    cognome: values.cognome,
    email: values.email
  };

  if (Object.prototype.hasOwnProperty.call(row, "telefono")) {
    payload.telefono = values.telefono || null;
  }

  if (Object.prototype.hasOwnProperty.call(row, "data_nascita")) {
    payload.data_nascita = values.data_nascita || null;
  }

  if (Object.prototype.hasOwnProperty.call(row, "sesso")) {
    payload.sesso = values.sesso;
  }

  return payload;
}

function isAdultBirthDate(value: string): boolean {
  if (!value) {
    return false;
  }

  const birth = new Date(`${value}T00:00:00`);

  if (Number.isNaN(birth.getTime())) {
    return false;
  }

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }

  return age >= 18;
}

router.get("/clienti", async (_req: Request, res: Response) => {
  try {
    const { clienti } = await getClientiWithSource();

    return res.json({
      clienti
    });
  } catch (err: any) {
    console.error("Errore GET /clienti:", err);
    return res.status(500).json({ message: err.message });
  }
});

router.post("/clienti", async (req: Request, res: Response) => {
  try {
    const nome = String(req.body?.nome ?? "").trim();
    const cognome = String(req.body?.cognome ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const telefono = String(req.body?.telefono ?? "").trim();
    const data_nascita = String(req.body?.data_nascita ?? "").trim();
    const sesso = normalizeSesso(req.body?.sesso);

    if (!nome || !cognome || !email || !telefono || !data_nascita || !sesso) {
      return res.status(400).json({ message: "Nome, cognome, email, telefono, data di nascita e sesso sono obbligatori" });
    }

    if (!isAdultBirthDate(data_nascita)) {
      return res.status(400).json({ message: "Il cliente deve essere maggiorenne" });
    }

    const { data: existingUser, error: existingError } = await db
      .from("utenti")
      .select("idUtente")
      .eq("email", email)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingUser) {
      return res.status(400).json({ message: "Esiste gia un utente con questa email" });
    }

    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
    const resetPasswordToken = crypto.randomBytes(32).toString("hex");
    const resetPasswordExpires = new Date(Date.now() + MANAGED_CLIENT_RESET_TTL_MS).toISOString();

    const { data, error } = await db
      .from("utenti")
      .insert({
        nome,
        cognome,
        email,
        password: hashedPassword,
        telefono: telefono || null,
        data_nascita: data_nascita || null,
        sesso,
        ruolo: "cliente",
        mustChangePassword: true,
        resetPasswordToken,
        resetPasswordExpires
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    const cliente = normalizeClienteRow(data, "utenti");

    if (!cliente) {
      return res.status(500).json({ message: "Cliente creato ma non leggibile" });
    }

    sendMailInBackground("Errore invio mail password cliente", () =>
      sendManagedClientPasswordEmail(cliente, buildResetLink(resetPasswordToken))
    );

    return res.status(201).json(cliente);
  } catch (err: any) {
    console.error("Errore POST /clienti:", err);

    if (isMissingManagedPasswordColumnError(err)) {
      return res.status(500).json({
        message: "Prima di inserire clienti dal gestionale devi eseguire la migrazione db/managed_client_password_flow.sql in Supabase, poi ricaricare lo schema cache."
      });
    }

    return res.status(500).json({ message: err.message });
  }
});

router.put("/clienti/:id", async (req: Request, res: Response) => {
  try {
    const idUtente = Number(req.params.id);
    const nome = String(req.body?.nome ?? "").trim();
    const cognome = String(req.body?.cognome ?? "").trim();
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const telefono = String(req.body?.telefono ?? "").trim();
    const data_nascita = String(req.body?.data_nascita ?? "").trim();
    const sesso = normalizeSesso(req.body?.sesso);

    if (!Number.isFinite(idUtente) || idUtente <= 0) {
      return res.status(400).json({ message: "Cliente non valido" });
    }

    if (!nome || !cognome || !email || !sesso) {
      return res.status(400).json({ message: "Nome, cognome, email e sesso sono obbligatori" });
    }

    const lookup = await getClientLookupById(idUtente);

    if (lookup.source === "clienti" && lookup.idColumn) {
      const { data, error } = await db
        .from("clienti")
        .update(buildClientiUpdatePayload(lookup.row, {
          nome,
          cognome,
          email,
          telefono,
          data_nascita,
          sesso
        }))
        .eq(lookup.idColumn, idUtente)
        .select("*")
        .limit(1);

      if (error) {
        throw error;
      }

      const cliente = normalizeClienteRow(Array.isArray(data) ? data[0] : data, "clienti");

      if (!cliente) {
        return res.status(404).json({ message: "Cliente non trovato" });
      }

      return res.json(cliente);
    }

    const { data: existingUser, error: existingError } = await db
      .from("utenti")
      .select("idUtente")
      .eq("email", email)
      .neq("idUtente", idUtente)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingUser) {
      return res.status(400).json({ message: "Esiste gia un utente con questa email" });
    }

    const { data, error } = await db
      .from("utenti")
      .update({
        nome,
        cognome,
        email,
        telefono: telefono || null,
        data_nascita: data_nascita || null,
        sesso
      })
      .eq("idUtente", idUtente)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    const cliente = normalizeClienteRow(data, "utenti");

    if (!cliente || ["operatore", "titolare", "salone"].includes(String(cliente.ruolo || "").toLowerCase())) {
      return res.status(404).json({ message: "Cliente non trovato" });
    }

    return res.json(cliente);
  } catch (err: any) {
    console.error("Errore PUT /clienti/:id:", err);
    return res.status(500).json({ message: err.message });
  }
});

router.delete("/clienti/:id", async (req: Request, res: Response) => {
  try {
    const idUtente = Number(req.params.id);

    if (!Number.isFinite(idUtente) || idUtente <= 0) {
      return res.status(400).json({ message: "Cliente non valido" });
    }

    const lookup = await getClientLookupById(idUtente);

    if (lookup.source === "clienti" && lookup.idColumn) {
      const { data, error } = await db
        .from("clienti")
        .delete()
        .eq(lookup.idColumn, idUtente)
        .select("*")
        .limit(1);

      if (error) {
        throw error;
      }

      if (!Array.isArray(data) || data.length === 0) {
        return res.status(404).json({ message: "Cliente non trovato" });
      }

      return res.json({ message: "Cliente eliminato con successo" });
    }

    const { data: existingCliente, error: existingError } = await db
      .from("utenti")
      .select("idUtente, ruolo")
      .eq("idUtente", idUtente)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    const ruolo = String((existingCliente as any)?.ruolo ?? "").toLowerCase();

    if (!existingCliente || ["operatore", "titolare", "salone"].includes(ruolo)) {
      return res.status(404).json({ message: "Cliente non trovato" });
    }

    const { data, error } = await db
      .from("utenti")
      .delete()
      .eq("idUtente", idUtente)
      .select("idUtente, ruolo")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ message: "Cliente non trovato" });
    }

    return res.json({ message: "Cliente eliminato con successo" });
  } catch (err: any) {
    console.error("Errore DELETE /clienti/:id:", err);
    return res.status(500).json({ message: err.message });
  }
});

router.get("/operatori", async (_req: Request, res: Response) => {
  try {
    const { data, error } = await db
      .from("utenti")
      .select("idUtente, nome, cognome, email, telefono, data_nascita, sesso, ruolo")
      .in("ruolo", ["operatore", "titolare"])
      .order("cognome", { ascending: true })
      .order("nome", { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({
      operatori: (data || []) as Utente[]
    });
  } catch (err: any) {
    console.error("Errore GET /operatori:", err);
    return res.status(500).json({ message: err.message });
  }
});
export default router;
