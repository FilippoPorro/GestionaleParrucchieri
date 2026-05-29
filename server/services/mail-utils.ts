import nodemailer from "nodemailer";

export type MailSendInfo = {
  provider: "sendgrid" | "smtp";
  accepted?: string[];
  rejected?: string[];
  messageId?: string;
  response?: string;
};

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

function getMailFrom(): string {
  const from = process.env.SENDGRID_FROM || process.env.SMTP_FROM;

  if (!from) {
    throw new Error("SENDGRID_FROM o SMTP_FROM non configurato");
  }

  return from;
}

async function sendWithSendGrid(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<MailSendInfo> {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY non configurata");
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: params.to }]
        }
      ],
      from: {
        email: getMailFrom(),
        name: "I Parrucchieri"
      },
      subject: params.subject,
      content: [
        {
          type: "text/html",
          value: params.html
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SendGrid error ${response.status}: ${body}`);
  }

  return {
    provider: "sendgrid",
    accepted: [params.to],
    rejected: [],
    messageId: response.headers.get("x-message-id") || undefined,
    response: `${response.status} ${response.statusText}`
  };
}

async function sendWithSmtp(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<MailSendInfo> {
  const transporter = createSmtpTransporter();
  const info = await transporter.sendMail({
    from: `"I Parrucchieri" <${getMailFrom()}>`,
    to: params.to,
    subject: params.subject,
    html: params.html
  });

  return {
    provider: "smtp",
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
    rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
    messageId: info.messageId,
    response: info.response
  };
}

export async function sendHtmlMail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<MailSendInfo> {
  if (process.env.SENDGRID_API_KEY) {
    return sendWithSendGrid(params);
  }

  return sendWithSmtp(params);
}

export function sendMailInBackground(label: string, send: () => Promise<unknown>): void {
  const actionLabel = label.replace(/^Errore\s+/i, "");

  setImmediate(() => {
    console.info(`${actionLabel} avviato`);

    send()
      .then((info) => {
        console.info(`${actionLabel} completato`, info);
      })
      .catch((error) => {
        console.error(`${label}:`, error);
      });
  });
}
