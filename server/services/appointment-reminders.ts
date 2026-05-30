import { db } from "../db_parrucchieri";
import {
  AppointmentMailPayload,
  AppointmentMailService,
  AppointmentMailUser,
  sendAppointmentReminderEmail
} from "./appointment-email";

type ReminderAppointment = {
  idAppuntamento: number;
  idCliente: number;
  idOperatore: number;
  dataOraInizio: string;
  dataOraFine: string;
  note: string | null;
  stato: string;
};

type ReminderNotification = {
  idAppuntamento: number;
  tipo: string;
};

const REMINDER_TYPE = "email_reminder_24h";
const REMINDER_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const REMINDER_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 15 * 60 * 1000;

let reminderJobStarted = false;
let reminderJobRunning = false;
let lastReminderCheckAt: Date | null = null;

function toIsoLocalString(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function getUserById(idUtente: number): Promise<AppointmentMailUser | null> {
  const { data, error } = await db
    .from("utenti")
    .select("idUtente, nome, cognome, email")
    .eq("idUtente", idUtente)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AppointmentMailUser | null) ?? null;
}

async function getServiceByAppointment(appointment: ReminderAppointment): Promise<AppointmentMailService | null> {
  const { data: relations, error: relationError } = await db
    .from("appuntamentiservizi")
    .select("idServizio")
    .eq("idAppuntamento", appointment.idAppuntamento)
    .limit(1);

  if (relationError) {
    throw relationError;
  }

  const relation = Array.isArray(relations) ? relations[0] : null;
  const serviceId = Number(relation?.idServizio);

  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return appointment.note
      ? { idServizio: 0, nome: appointment.note }
      : null;
  }

  const { data: service, error: serviceError } = await db
    .from("servizi")
    .select("idServizio, nome, prezzo")
    .eq("idServizio", serviceId)
    .maybeSingle();

  if (serviceError) {
    throw serviceError;
  }

  return (service as AppointmentMailService | null) ?? null;
}

async function hasReminderBeenSent(idAppuntamento: number): Promise<boolean> {
  const { data, error } = await db
    .from("notifiche_email_appuntamenti")
    .select("idAppuntamento, tipo")
    .eq("idAppuntamento", idAppuntamento)
    .eq("tipo", REMINDER_TYPE)
    .limit(1);

  if (error) {
    throw error;
  }

  return Array.isArray(data) && data.length > 0;
}

async function markReminderAsSent(idAppuntamento: number): Promise<void> {
  const { error } = await db
    .from("notifiche_email_appuntamenti")
    .insert({
      idAppuntamento,
      tipo: REMINDER_TYPE,
      sentAt: new Date().toISOString()
    });

  if (error) {
    throw error;
  }
}

async function buildReminderMailPayload(appointment: ReminderAppointment): Promise<AppointmentMailPayload | null> {
  const cliente = await getUserById(appointment.idCliente);

  if (!cliente?.email) {
    return null;
  }

  const operatore = await getUserById(appointment.idOperatore);
  const servizio = await getServiceByAppointment(appointment);

  return {
    cliente,
    operatore,
    servizio,
    dataOraInizio: appointment.dataOraInizio,
    dataOraFine: appointment.dataOraFine
  };
}

async function processAppointmentReminder(appointment: ReminderAppointment): Promise<void> {
  if (await hasReminderBeenSent(appointment.idAppuntamento)) {
    return;
  }

  const payload = await buildReminderMailPayload(appointment);

  if (!payload) {
    return;
  }

  await sendAppointmentReminderEmail(payload);
  await markReminderAsSent(appointment.idAppuntamento);
}

async function runReminderJob(): Promise<void> {
  if (reminderJobRunning) {
    return;
  }

  reminderJobRunning = true;

  try {
    const now = new Date();
    const checkStart = lastReminderCheckAt
      ? new Date(lastReminderCheckAt)
      : new Date(now.getTime() - REMINDER_WINDOW_MS);
    const windowStart = new Date(checkStart.getTime() + REMINDER_LOOKAHEAD_MS);
    const windowEnd = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS);

    const { data, error } = await db
      .from("appuntamenti")
      .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, note, stato")
      .gte("dataOraInizio", toIsoLocalString(windowStart))
      .lt("dataOraInizio", toIsoLocalString(windowEnd))
      .eq("stato", "prenotato");

    if (error) {
      throw error;
    }

    const appointments = (data || []) as ReminderAppointment[];

    for (const appointment of appointments) {
      try {
        await processAppointmentReminder(appointment);
      } catch (appointmentError) {
      }
    }
  } catch (error) {
  } finally {
    lastReminderCheckAt = new Date();
    reminderJobRunning = false;
  }
}

export function startAppointmentReminderJob() {
  if (reminderJobStarted) {
    return;
  }

  reminderJobStarted = true;
  void runReminderJob();
  setInterval(() => {
    void runReminderJob();
  }, REMINDER_CHECK_INTERVAL_MS);
}
