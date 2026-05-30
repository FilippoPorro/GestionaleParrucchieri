import express, { Request, Response } from "express";
import jwt from "jsonwebtoken";
import passport from "../config/passport";

const router = express.Router();

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || "http://localhost:4200").replace(/\/+$/, "");
}

function getAllowedFrontendUrls(): string[] {
  return (
    process.env.FRONTEND_URLS ||
    process.env.FRONTEND_URL ||
    "http://localhost:4200"
  )
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function isAllowedFrontendUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const origin = parsedUrl.origin.replace(/\/+$/, "");

    return origin === "http://localhost:4200" ||
      origin === "http://127.0.0.1:4200" ||
      getAllowedFrontendUrls().includes(origin) ||
      /^https:\/\/gestionale-parrucchieri-[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
      /^https:\/\/sito-parrucchieri-[a-z0-9-]+\.vercel\.app$/i.test(origin);
  } catch {
    return false;
  }
}

function getFrontendUrlFromRequest(req: Request): string {
  const stateUrl = typeof req.query.state === "string" ? req.query.state : "";

  if (stateUrl && isAllowedFrontendUrl(stateUrl)) {
    return new URL(stateUrl).origin.replace(/\/+$/, "");
  }

  return getFrontendUrl();
}

function buildClientRedirect(path: string, params: Record<string, string>, frontendUrl = getFrontendUrl()): string {
  const query = new URLSearchParams(params);
  return `${frontendUrl.replace(/\/+$/, "")}${path}?${query.toString()}`;
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

router.get("/google", (req: Request, res: Response, next) => {
  const frontendUrl = typeof req.query.frontendUrl === "string" && isAllowedFrontendUrl(req.query.frontendUrl)
    ? new URL(req.query.frontendUrl).origin.replace(/\/+$/, "")
    : getFrontendUrl();

  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
    state: frontendUrl
  })(req, res, next);
});

router.get(
  "/google/callback",
  (req: Request, res: Response, next) => {
    const frontendUrl = getFrontendUrlFromRequest(req);

    passport.authenticate(
      "google",
      { session: false },
      (err: unknown, user?: JwtUser) => {
        if (err) {
          return res.redirect(buildClientRedirect("/login", {
            googleError: "true",
            reason: "callback"
          }, frontendUrl));
        }

        if (!user) {
          return res.redirect(buildClientRedirect("/login", {
            googleError: "true",
            reason: "no-user"
          }, frontendUrl));
        }

        try {
          const token = generateToken(user);
          return res.redirect(buildClientRedirect("/login", { token }, frontendUrl));
        } catch (tokenError) {
          return res.redirect(buildClientRedirect("/login", {
            googleError: "true",
            reason: "token"
          }, frontendUrl));
        }
      }
    )(req, res, next);
  }
);

export default router;
