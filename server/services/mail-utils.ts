import nodemailer from "nodemailer";

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createSmtpTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    throw new Error("Configurazione SMTP incompleta");
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
    connectionTimeout: getNumberEnv("SMTP_CONNECTION_TIMEOUT_MS", 5000),
    greetingTimeout: getNumberEnv("SMTP_GREETING_TIMEOUT_MS", 5000),
    socketTimeout: getNumberEnv("SMTP_SOCKET_TIMEOUT_MS", 8000),
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });
}

export function sendMailInBackground(label: string, send: () => Promise<void>): void {
  setImmediate(() => {
    send().catch((error) => {
      console.error(`${label}:`, error);
    });
  });
}
