import { sendHtmlMail } from "./mail-utils";

interface ManagedClientMailUser {
  nome: string;
  cognome: string;
  email: string;
}

const DEFAULT_LOGO_URL =
  "https://res.cloudinary.com/duimlq34k/image/upload/v1776668316/logo-parrucchieri-oro-bianco_jkgk5v.png";

function buildAccountDetailsBlock(resetLink: string): string {
  return `
    <div class="mail-details" style="margin:0 0 18px;padding:18px;border:1px solid #efc983;border-radius:16px;background:#fbf3e3;">
      <div class="mail-details-label" style="margin:0 0 8px;font-size:14px;color:#c08612;font-weight:700;">Dettagli account</div>
      <div class="mail-details-content" style="font-size:15px;line-height:1.8;color:#1a1a1a;">
        <div><strong>Accesso:</strong> email personale</div>
        <div><strong>Password:</strong> da impostare al primo accesso</div>
        <div><strong>Validita link:</strong> 7 giorni</div>
      </div>
    </div>

    <div style="margin:0 0 18px;text-align:left;">
      <a
        href="${resetLink}"
        style="display:inline-block;padding:14px 22px;background:#d7af5b !important;background-color:#d7af5b !important;color:#111111 !important;text-decoration:none;border-radius:12px;font-size:15px;font-weight:700;"
      >
        Imposta password
      </a>
    </div>

    <div style="padding:14px 16px;border:1px solid #ead7b6;border-radius:14px;background:#faf7f2 !important;background-color:#faf7f2 !important;word-break:break-all;">
      <div style="margin:0 0 6px;color:#7a6241 !important;font-size:12px;font-weight:700;">Se il pulsante non funziona, copia questo link:</div>
      <a href="${resetLink}" style="font-size:12px;line-height:1.7;color:#2563eb !important;text-decoration:underline;">${resetLink}</a>
    </div>
  `;
}

function buildManagedClientPasswordHtml(cliente: ManagedClientMailUser, resetLink: string): string {
  const logoUrl = process.env.APPOINTMENT_LOGO_URL_LIGHT || DEFAULT_LOGO_URL;

  return `
    <!DOCTYPE html>
    <html lang="it">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <title>Completa il tuo account</title>
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
                src="${logoUrl}"
                alt="I Parrucchieri"
                style="display:block;width:100%;height:auto;border:0;"
              />
            </div>

            <div class="mail-card" style="margin:0 auto;max-width:718px;background:#ffffff !important;background-color:#ffffff !important;border:1px solid #e2c89b;border-radius:20px;padding:24px 34px 22px;text-align:left;box-sizing:border-box;color:#1a1a1a !important;">
              <div class="mail-badge" style="display:inline-block;margin-bottom:8px;padding:6px 12px;border:1px solid #e5c37d;border-radius:999px;background:#f8f2e8 !important;background-color:#f8f2e8 !important;color:#b67a08 !important;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">
                Account Cliente
              </div>

              <h1 class="mail-title" style="margin:0 0 10px;font-size:30px;line-height:1.2;color:#101010 !important;font-weight:800;">
                Completa il tuo account
              </h1>

              <p class="mail-copy" style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                Ciao ${cliente.nome} ${cliente.cognome},
              </p>

              <p class="mail-copy" style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#1a1a1a !important;">
                il salone ha creato il tuo account su <strong>I Parrucchieri</strong>. Per sicurezza devi scegliere una password personale prima di usare il sito.
              </p>

              ${buildAccountDetailsBlock(resetLink)}

              <p class="mail-footer" style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#3a3126 !important;">
                Se non hai richiesto tu l'account, puoi ignorare questa email o contattare direttamente il salone.
              </p>
            </div>

            <div class="mail-meta" style="padding-top:14px;text-align:center;color:#8b7555 !important;">
              <div style="font-size:13px;line-height:1.5;color:#8b7555 !important;">I Parrucchieri, Fossano</div>
              <div style="font-size:11px;line-height:1.6;color:#8b7555 !important;">Questa e una comunicazione automatica relativa al tuo account.</div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendManagedClientPasswordEmail(cliente: ManagedClientMailUser, resetLink: string): Promise<void> {
  await sendHtmlMail({
    to: cliente.email,
    subject: "Completa il tuo account I Parrucchieri",
    html: buildManagedClientPasswordHtml(cliente, resetLink)
  });
}
