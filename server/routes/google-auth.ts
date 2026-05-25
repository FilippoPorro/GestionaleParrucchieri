import express, { Request, Response } from "express";
import jwt from "jsonwebtoken";
import passport from "../config/passport";

const router = express.Router();

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:4200").replace(/\/+$/, "");
}

function buildClientRedirect(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${getFrontendUrl()}${path}?${query.toString()}`;
}

interface JwtUser {
  id: number;
  nome: string;
  cognome: string;
  email: string;
  ruolo: string;
  photoURL?: string | null;
}

function generateToken(user: JwtUser) {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error("JWT_SECRET mancante nel file .env");
  }

  return jwt.sign(
    {
      userId: user.id,
      nome: user.nome,
      cognome: user.cognome,
      email: user.email,
      ruolo: user.ruolo,
      photoURL: user.photoURL ?? null,
    },
    jwtSecret,
    { expiresIn: "1d" }
  );
}

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account"
  })
);

router.get(
  "/google/callback",
  (req: Request, res: Response, next) => {
    passport.authenticate(
      "google",
      { session: false },
      (err: unknown, user?: JwtUser) => {
        if (err) {
          console.error("Errore passport callback Google:", err);
          return res.redirect(buildClientRedirect("/login", {
            googleError: "true",
            reason: "callback"
          }));
        }

        if (!user) {
          return res.redirect(buildClientRedirect("/login", {
            googleError: "true",
            reason: "no-user"
          }));
        }

        try {
          const token = generateToken(user);
          return res.redirect(buildClientRedirect("/login", { token }));
        } catch (tokenError) {
          console.error("Errore generazione token Google:", tokenError);
          return res.redirect(buildClientRedirect("/login", {
            googleError: "true",
            reason: "token"
          }));
        }
      }
    )(req, res, next);
  }
);

export default router;
