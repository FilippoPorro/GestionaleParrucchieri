import { sendHtmlMail } from "./mail-utils";

export interface AppointmentMailUser {
  idUtente: number;
  nome: string;
  cognome: string;
  email: string;
}

export interface AppointmentMailService {
  idServizio: number;
  nome: string;
  prezzo?: number | null;
}

export interface AppointmentMailPayload {
  cliente: AppointmentMailUser;
  operatore: AppointmentMailUser | null;
  servizio: AppointmentMailService | null;
  dataOraInizio: string;
  dataOraFine: string;
}

const DEFAULT_LOGO_URL =
  "https://res.cloudinary.com/duimlq34k/image/upload/v1776668316/logo-parrucchieri-oro-bianco_jkgk5v.png";

function formatAppointmentDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function buildAppointmentInfoBlock(params: AppointmentMailPayload): string {
  const servizioLabel = params.servizio?.nome || "Servizio prenotato";
  const operatoreLabel = params.operatore
    ? `${params.operatore.nome} ${params.operatore.cognome}`
    : "Operatore assegnato";

  return `
    <div class="mail-details" style="margin:0 0 18px;padding:18px;border:1px solid #efc983;border-radius:16px;background:#fbf3e3;">
      <div class="mail-details-label" style="margin:0 0 8px;font-size:14px;color:#c08612;font-weight:700;">Dettagli appuntamento</div>
      <div class="mail-details-content" style="font-size:15px;line-height:1.8;color:#1a1a1a;">
        <div><strong>Servizio:</strong> ${servizioLabel}</div>
        <div><strong>Operatore:</strong> ${operatoreLabel}</div>
        <div><strong>Inizio:</strong> ${formatAppointmentDateTime(params.dataOraInizio)}</div>
        <div><strong>Fine:</strong> ${formatAppointmentDateTime(params.dataOraFine)}</div>
      </div>
    </div>
  `;
}

function getLogoUrls() {
  return {
    light: process.env.APPOINTMENT_LOGO_URL_LIGHT || DEFAULT_LOGO_URL
  };
}

function wrapMailContent(
  title: string,
  badge: string,
  greeting: string,
  intro: string,
  detailsBlock: string,
  footerCopy: string
) {
  const logoUrls = getLogoUrls();

  return `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>${title}</title>
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
          .mail-title,
          .mail-copy,
          .mail-footer,
          .mail-details-content,
          .mail-meta,
          .mail-meta div,
          .mail-details-label {
            color: inherit !important;
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
                src="${logoUrls.light}"
                alt="I Parrucchieri"
                style="display:block;width:100%;height:auto;border:0;"
              />
            </div>

            <div class="mail-card" style="margin:0 auto;max-width:718px;background:#ffffff !important;background-color:#ffffff !important;border:1px solid #e2c89b;border-radius:20px;padding:24px 34px 22px;text-align:left;box-sizing:border-box;color:#1a1a1a !important;">
              <div class="mail-badge" style="display:inline-block;margin-bottom:8px;padding:6px 12px;border:1px solid #e5c37d;border-radius:999px;background:#f8f2e8 !important;background-color:#f8f2e8 !important;color:#b67a08 !important;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                ${badge}
              </div>

              <h1 class="mail-title" style="margin:0 0 10px;font-size:30px;line-height:1.2;color:#101010 !important;font-weight:800;">
                ${title}
              </h1>

              <p class="mail-copy" style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                ${greeting}
              </p>

              <p class="mail-copy" style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                ${intro}
              </p>

              ${detailsBlock}

              <p class="mail-footer" style="margin:0;font-size:14px;line-height:1.7;color:#3a3126 !important;">
                ${footerCopy}
              </p>
            </div>

            <div class="mail-meta" style="padding-top:14px;text-align:center;color:#8b7555 !important;">
              <div style="font-size:13px;line-height:1.5;color:#8b7555 !important;">I Parrucchieri, Fossano</div>
              <div style="font-size:11px;line-height:1.6;color:#8b7555 !important;">Questa e una comunicazione automatica relativa al tuo appuntamento.</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

async function sendMail(to: string, subject: string, html: string) {
  return sendHtmlMail({ to, subject, html });
}

export async function sendAppointmentConfirmationEmail(params: AppointmentMailPayload) {
  const html = wrapMailContent(
    "La tua prenotazione e confermata",
    "Conferma Appuntamento",
    `Ciao ${params.cliente.nome} ${params.cliente.cognome},`,
    `abbiamo registrato con successo il tuo appuntamento presso <strong>I Parrucchieri</strong>.`,
    buildAppointmentInfoBlock(params),
    "Se hai bisogno di modificare la prenotazione, contattaci con anticipo."
  );

  return sendMail(params.cliente.email, "Conferma appuntamento", html);
}

export async function sendAppointmentReminderEmail(params: AppointmentMailPayload) {
  const html = wrapMailContent(
    "Promemoria appuntamento di domani",
    "Reminder 24 Ore",
    `Ciao ${params.cliente.nome} ${params.cliente.cognome},`,
    `ti ricordiamo che domani hai un appuntamento prenotato presso <strong>I Parrucchieri</strong>.`,
    buildAppointmentInfoBlock(params),
    "Ti aspettiamo in salone. Se hai bisogno di modificare la prenotazione, contattaci appena possibile."
  );

  return sendMail(params.cliente.email, "Promemoria appuntamento di domani", html);
}

export async function sendAppointmentUpdatedEmail(params: AppointmentMailPayload) {
  const html = wrapMailContent(
    "Il tuo appuntamento è stato aggiornato",
    "Appuntamento Modificato",
    `Ciao ${params.cliente.nome} ${params.cliente.cognome},`,
    `ti confermiamo che il tuo appuntamento presso <strong>I Parrucchieri</strong> è stato aggiornato con i nuovi dettagli qui sotto.`,
    buildAppointmentInfoBlock(params),
    "Se la modifica non ti risulta corretta, contattaci appena possibile."
  );

  return sendMail(params.cliente.email, "Appuntamento aggiornato", html);
}

export async function sendAppointmentCancelledEmail(params: AppointmentMailPayload) {
  const html = wrapMailContent(
    "Il tuo appuntamento e stato annullato",
    "Appuntamento Eliminato",
    `Ciao ${params.cliente.nome} ${params.cliente.cognome},`,
    `ti informiamo che il tuo appuntamento presso <strong>I Parrucchieri</strong> è stato annullato.`,
    buildAppointmentInfoBlock(params),
    "Se desideri fissare una nuova data, puoi prenotare nuovamente quando preferisci."
  );

  return sendMail(params.cliente.email, "Appuntamento annullato", html);
}
