import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { db } from "../db_parrucchieri";
import { verifyToken } from "../middleware/authMiddleware";

const router = express.Router();

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:4200").replace(/\/+$/, "");
}

function buildClientUrl(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${getFrontendUrl()}${path}?${query.toString()}`;
}

interface User {
  idUtente: number;
  nome: string;
  cognome: string;
  email: string;
  password: string;
  telefono: string | null;
  data_nascita: string | null;
  sesso: "m" | "f" | null;
  ruolo: string;
  photoURL?: string | null;
  picture?: string | null;
  avatar_url?: string | null;
  avatar?: string | null;
  mustChangePassword?: boolean;
  resetPasswordToken?: string | null;
  resetPasswordExpires?: string | null;
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

function buildJwt(user: Pick<User, "idUtente" | "nome" | "cognome" | "email" | "ruolo"> & { mustChangePassword?: boolean }): string {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET mancante nel file .env");
  }

  return jwt.sign(
    {
      userId: user.idUtente,
      nome: user.nome,
      cognome: user.cognome,
      email: user.email,
      ruolo: user.ruolo,
      mustChangePassword: !!user.mustChangePassword
    },
    jwtSecret,
    { expiresIn: "1d" }
  );
}

async function getUserByEmail(email: string): Promise<User | null> {
  const { data, error } = await db
    .from("utenti")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as User | null;
}

async function getUserById(idUtente: number): Promise<User | null> {
  const { data, error } = await db
    .from("utenti")
    .select("*")
    .eq("idUtente", idUtente)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as User | null;
}

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email e password obbligatorie" });
    }

    const user = await getUserByEmail(String(email).trim().toLowerCase());

    if (!user) {
      return res.status(404).json({ message: "Utente non trovato" });
    }

    if (!user.password || user.password.trim() === "") {
      return res.status(400).json({
        message: "Questo account è registrato con Google. Accedi con Google."
      });
    }

    const validate = await bcrypt.compare(password, user.password);

    if (!validate) {
      return res.status(401).json({ message: "Password errata" });
    }

    const token = buildJwt(user);

    return res.json({
      message: "Login effettuato con successo",
      token,
      user: {
        id: user.idUtente,
        nome: user.nome,
        cognome: user.cognome,
        email: user.email,
        telefono: user.telefono,
        data_nascita: user.data_nascita,
        sesso: user.sesso,
        ruolo: user.ruolo,
        mustChangePassword: !!user.mustChangePassword
      }
    });
  } catch (err: any) {
    console.error("Errore POST /login:", err);
    return res.status(500).json({ message: err.message });
  }
});

router.get("/me", verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({ message: "Utente non trovato" });
    }

    return res.json({
      idUtente: user.idUtente,
      nome: user.nome,
      cognome: user.cognome,
      email: user.email,
      telefono: user.telefono,
      data_nascita: user.data_nascita,
      sesso: user.sesso,
      ruolo: user.ruolo,
      hasPassword: !!user.password && user.password.trim() !== "",
      mustChangePassword: !!user.mustChangePassword,
      photoURL:
        req.user?.photoURL ??
        (user as any).photoURL ??
        (user as any).picture ??
        (user as any).avatar_url ??
        (user as any).avatar ??
        null
    });
  } catch (error: any) {
    console.error("Errore GET /me:", error);
    return res.status(500).json({ message: "Errore server" });
  }
});

router.put("/me", verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const { nome, cognome, telefono, data_nascita, password } = req.body;
    const sesso = normalizeSesso(req.body?.sesso);

    if (!nome || !cognome || !telefono || !data_nascita || !sesso) {
      return res.status(400).json({
        message: "Nome, cognome, telefono, data di nascita e sesso sono obbligatori"
      });
    }

    const updatePayload: Partial<User> = {
      nome,
      cognome,
      telefono,
      data_nascita,
      sesso
    };

    if (password && password.trim() !== "") {
      if (password.trim().length < 6) {
        return res.status(400).json({
          message: "La password deve contenere almeno 6 caratteri"
        });
      }

      updatePayload.password = await bcrypt.hash(password.trim(), 10);
      updatePayload.mustChangePassword = false;
    }

    const { error } = await db
      .from("utenti")
      .update(updatePayload)
      .eq("idUtente", userId);

    if (error) {
      throw error;
    }

    return res.json({ message: "Dati aggiornati con successo" });
  } catch (error: any) {
    console.error("Errore PUT /me:", error);
    return res.status(500).json({ message: "Errore server" });
  }
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const nome = req.body.nome;
    const cognome = req.body.cognome;
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = req.body.password;
    const telefono = req.body.telefono;
    const data_nascita = req.body.data_nascita;
    const sesso = normalizeSesso(req.body.sesso);
    const ruolo = req.body.ruolo || "cliente";

    if (!nome || !cognome || !email || !password || !sesso) {
      return res.status(400).json({
        message: "Campi obbligatori mancanti"
      });
    }

    const existing = await getUserByEmail(email);

    if (existing) {
      return res.status(400).json({
        message: "Email già registrata"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data: createdUser, error } = await db
      .from("utenti")
      .insert({
        nome,
        cognome,
        email,
        password: hashedPassword,
        telefono: telefono || null,
        data_nascita: data_nascita || null,
        sesso,
        ruolo
      })
      .select("idUtente, nome, cognome, email, telefono, data_nascita, sesso, ruolo")
      .single();

    if (error) {
      throw error;
    }

    const token = buildJwt({
      idUtente: createdUser.idUtente,
      nome: createdUser.nome,
      cognome: createdUser.cognome,
      email: createdUser.email,
      ruolo: createdUser.ruolo,
      mustChangePassword: false
    });

    return res.status(201).json({
      message: "Registrazione completata",
      token,
      user: {
        id: createdUser.idUtente,
        nome: createdUser.nome,
        cognome: createdUser.cognome,
        email: createdUser.email,
        telefono: createdUser.telefono,
        data_nascita: createdUser.data_nascita,
        sesso: createdUser.sesso,
        ruolo: createdUser.ruolo
      }
    });

  } catch (err: any) {
    console.error("Errore POST /register:", err);
    return res.status(500).json({
      message: "Errore server"
    });
  }
});

router.post("/verify-password", verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const { currentPassword } = req.body;

    if (!currentPassword || currentPassword.trim() === "") {
      return res.status(400).json({
        message: "La password attuale è obbligatoria"
      });
    }

    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({
        message: "Utente non trovato"
      });
    }

    if (!user.password || user.password.trim() === "") {
      return res.status(400).json({
        message: "Questo account non ha una password locale configurata"
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(401).json({
        message: "La password attuale non è corretta"
      });
    }

    return res.status(200).json({
      message: "Identità verificata con successo"
    });
  } catch (error: any) {
    console.error("Errore POST /verify-password:", error);
    return res.status(500).json({
      message: "Errore server"
    });
  }
});

router.post("/change-password", verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (
      !currentPassword || currentPassword.trim() === "" ||
      !newPassword || newPassword.trim() === "" ||
      !confirmNewPassword || confirmNewPassword.trim() === ""
    ) {
      return res.status(400).json({
        message: "Tutti i campi password sono obbligatori"
      });
    }

    if (newPassword.trim().length < 6) {
      return res.status(400).json({
        message: "La nuova password deve contenere almeno 6 caratteri"
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        message: "La conferma della nuova password non coincide"
      });
    }

    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({
        message: "Utente non trovato"
      });
    }

    if (!user.password || user.password.trim() === "") {
      return res.status(400).json({
        message: "Questo account non ha una password locale configurata"
      });
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        message: "La password attuale non è corretta"
      });
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);

    if (isSamePassword) {
      return res.status(400).json({
        message: "La nuova password deve essere diversa da quella attuale"
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword.trim(), 10);

    const { error } = await db
      .from("utenti")
      .update({
        password: hashedPassword,
        mustChangePassword: false
      })
      .eq("idUtente", userId);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message: "Password aggiornata con successo"
    });
  } catch (error: any) {
    console.error("Errore POST /change-password:", error);
    return res.status(500).json({
      message: "Errore server"
    });
  }
});

router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || String(email).trim() === "") {
      return res.status(400).json({
        message: "L'email è obbligatoria"
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await getUserByEmail(cleanEmail);

    if (!user) {
      return res.status(200).json({
        message: "Se l’email esiste, riceverai un link per reimpostare la password"
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: updateError } = await db
      .from("utenti")
      .update({
        resetPasswordToken: resetToken,
        resetPasswordExpires
      })
      .eq("idUtente", user.idUtente);

    if (updateError) {
      throw updateError;
    }

    const resetLink = buildClientUrl("/reset-password", { token: resetToken });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: `"I Parrucchieri" <${process.env.SMTP_FROM}>`,
      to: cleanEmail,
      subject: "Reimposta la tua password",
      html: `
        <!DOCTYPE html>
        <html lang="it">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta name="color-scheme" content="light only" />
            <meta name="supported-color-schemes" content="light only" />
            <title>Reimposta la tua password</title>
            <style>
              :root {
                color-scheme: light only;
                supported-color-schemes: light only;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                background: #f6f0e6 !important;
                background-color: #f6f0e6 !important;
                color: #16120d !important;
              }
              body, table, td, div, p, a, h1 {
                font-family: Arial, sans-serif !important;
              }
              .mail-shell {
                background: #f6f0e6 !important;
                background-color: #f6f0e6 !important;
                color: #16120d !important;
              }
              .mail-card {
                background: #ffffff !important;
                background-color: #ffffff !important;
                color: #1a1a1a !important;
              }
              [data-ogsc] .mail-shell,
              [data-ogsb] .mail-shell,
              [data-ogsc] .mail-card,
              [data-ogsb] .mail-card {
                background: inherit !important;
                background-color: inherit !important;
                color: inherit !important;
              }
            </style>
          </head>
          <body style="margin:0;padding:0;background:#f6f0e6 !important;background-color:#f6f0e6 !important;color:#16120d !important;">
            <div class="mail-shell" style="margin:0;padding:32px 18px;background:#f6f0e6 !important;background-color:#f6f0e6 !important;font-family:Arial,sans-serif;color:#16120d !important;">
              <div style="max-width:760px;margin:0 auto;text-align:center;">
                <div style="margin:0 auto 14px;width:234px;background:#1b1610 !important;background-color:#1b1610 !important;border-radius:16px;padding:18px 22px;box-sizing:border-box;">
                  <img
                    src="https://res.cloudinary.com/duimlq34k/image/upload/v1776668316/logo-parrucchieri-oro-bianco_jkgk5v.png"
                    alt="I Parrucchieri"
                    style="display:block;width:100%;height:auto;border:0;"
                  />
                </div>

                <div class="mail-card" style="margin:0 auto;max-width:718px;background:#ffffff !important;background-color:#ffffff !important;border:1px solid #e2c89b;border-radius:20px;padding:24px 34px 22px;text-align:left;box-sizing:border-box;color:#1a1a1a !important;">
                  <div style="display:inline-block;margin-bottom:8px;padding:6px 12px;border:1px solid #e5c37d;border-radius:999px;background:#f8f2e8 !important;background-color:#f8f2e8 !important;color:#b67a08 !important;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                    Recupero Password
                  </div>

                  <h1 style="margin:0 0 10px;font-size:30px;line-height:1.2;color:#101010 !important;font-weight:800;">
                    Reimposta la password del tuo account
                  </h1>

                  <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                    Ciao ${user.nome} ${user.cognome},
                  </p>

                  <p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                    Abbiamo ricevuto una richiesta per reimpostare la password associata al tuo account <strong>I Parrucchieri</strong>.
                  </p>

                  <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                    Per continuare, clicca sul pulsante qui sotto e scegli una nuova password. Il link restera valido per
                    <span style="color:#c57e0d !important;font-weight:700;">10 minuti</span>.
                  </p>

                  <div style="margin:0 0 18px;">
                    <a
                      href="${resetLink}"
                      style="display:inline-block;padding:14px 22px;background:#d7af5b !important;background-color:#d7af5b !important;color:#111111 !important;text-decoration:none;border-radius:12px;font-size:15px;font-weight:700;"
                    >
                      Reimposta password
                    </a>
                  </div>

                  <div style="margin:0 0 18px;padding:16px;border:1px solid #efc983;border-radius:14px;background:#fbf3e3 !important;background-color:#fbf3e3 !important;">
                    <div style="margin:0 0 8px;color:#c08612 !important;font-size:14px;font-weight:700;">Nota di sicurezza</div>
                    <div style="margin:0;font-size:14px;line-height:1.7;color:#1a1a1a !important;">
                      Se non hai richiesto tu questa operazione, puoi ignorare questa email. Nessuna modifica verra effettuata al tuo account.
                    </div>
                  </div>

                  <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#3a3126 !important;">
                    Se il pulsante non funziona, copia e incolla questo link nel browser:
                  </p>

                  <div style="padding:14px 16px;border:1px solid #ead7b6;border-radius:14px;background:#faf7f2 !important;background-color:#faf7f2 !important;word-break:break-all;">
                    <a href="${resetLink}" style="font-size:12px;line-height:1.7;color:#2563eb !important;text-decoration:underline;">${resetLink}</a>
                  </div>
                </div>

                <div style="padding-top:14px;text-align:center;color:#8b7555 !important;">
                  <div style="font-size:13px;line-height:1.5;color:#8b7555 !important;">I Parrucchieri, Fossano</div>
                  <div style="font-size:11px;line-height:1.6;color:#8b7555 !important;">Questa e una comunicazione automatica relativa alla sicurezza del tuo account.</div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `
    });

    return res.status(200).json({
      message: "Se l’email esiste, riceverai un link per reimpostare la password"
    });
  } catch (error: any) {
    console.error("Errore POST /forgot-password:", error);
    return res.status(500).json({
      message: "Errore server durante il recupero password"
    });
  }
});

router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || String(token).trim() === "") {
      return res.status(400).json({
        message: "Token mancante"
      });
    }

    if (!newPassword || String(newPassword).trim() === "") {
      return res.status(400).json({
        message: "La nuova password è obbligatoria"
      });
    }

    if (String(newPassword).trim().length < 6) {
      return res.status(400).json({
        message: "La nuova password deve contenere almeno 6 caratteri"
      });
    }

    if (!confirmPassword || String(confirmPassword).trim() === "") {
      return res.status(400).json({
        message: "La conferma della password è obbligatoria"
      });
    }

    if (String(newPassword).trim() !== String(confirmPassword).trim()) {
      return res.status(400).json({
        message: "Le password non coincidono"
      });
    }

    const cleanToken = String(token).trim();
    const cleanPassword = String(newPassword).trim();

    const { data: user, error } = await db
      .from("utenti")
      .select("idUtente, password, resetPasswordExpires")
      .eq("resetPasswordToken", cleanToken)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!user) {
      return res.status(400).json({
        message: "Il link di reset non è valido"
      });
    }

    if (!user.resetPasswordExpires) {
      return res.status(400).json({
        message: "Il link di reset non è valido o è scaduto"
      });
    }

    const expiresAt = new Date(user.resetPasswordExpires);
    const now = new Date();

    if (expiresAt.getTime() < now.getTime()) {
      return res.status(400).json({
        message: "Il link di reset è scaduto. Richiedine uno nuovo"
      });
    }

    if (user.password && user.password.trim() !== "") {
      const isSamePassword = await bcrypt.compare(cleanPassword, user.password);

      if (isSamePassword) {
        return res.status(400).json({
          message: "La nuova password deve essere diversa da quella attuale"
        });
      }
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    const { error: updateError } = await db
      .from("utenti")
      .update({
        password: hashedPassword,
        mustChangePassword: false,
        resetPasswordToken: null,
        resetPasswordExpires: null
      })
      .eq("idUtente", user.idUtente);

    if (updateError) {
      throw updateError;
    }

    return res.status(200).json({
      message: "Password aggiornata con successo"
    });
  } catch (error: any) {
    console.error("Errore POST /reset-password:", error);
    return res.status(500).json({
      message: "Errore server durante il reset della password"
    });
  }
});

export default router;
