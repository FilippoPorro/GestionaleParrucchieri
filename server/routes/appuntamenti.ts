import { Router, Request, Response } from "express";
import { db } from "../db_parrucchieri";
import { verifyToken } from "../middleware/authMiddleware";
import {
  AppointmentMailService,
  AppointmentMailUser,
  AppointmentMailPayload,
  sendAppointmentCancelledEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentUpdatedEmail
} from "../services/appointment-email";
import { sendMailInBackground } from "../services/mail-utils";

interface Appuntamento {
  idAppuntamento: number;
  idCliente: number | null;
  idOperatore: number;
  dataOraInizio: string;
  dataOraFine: string;
  stato: string | null;
  note: string | null;
  idServizio?: number | null;
  servizioNome?: string | null;
}

function isMissingAppointmentServiceOverrideColumnError(error: any): boolean {
  const combined = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`.toLowerCase();
  return combined.includes("prezzopersonalizzato") ||
    combined.includes("duratapersonalizzata") ||
    combined.includes("schema cache");
}

const router = Router();
const CUSTOMER_MIN_NOTICE_HOURS = 12;
const CUSTOMER_MIN_NOTICE_MS = CUSTOMER_MIN_NOTICE_HOURS * 60 * 60 * 1000;
const CUSTOMER_MIN_NOTICE_MESSAGE = "Per prenotare, modificare o annullare nelle 12 ore precedenti l'appuntamento chiama direttamente il salone.";

function normalizeEndDateTime(dataOraInizio: string, dataOraFine: string): string {
  if (dataOraFine.includes("T")) {
    return dataOraFine;
  }

  const [datePart] = dataOraInizio.split("T");
  return datePart ? `${datePart}T${dataOraFine}` : dataOraFine;
}

function isStaffRole(ruolo: unknown): boolean {
  return ruolo === "titolare" || ruolo === "operatore";
}

function isTitolareRole(ruolo: unknown): boolean {
  return ruolo === "titolare";
}

function isAppointmentConflictError(error: any): boolean {
  return typeof error?.message === "string" && /operator_unavailable/i.test(error.message);
}

function isMissingRpcError(error: any): boolean {
  return error?.code === "PGRST202" ||
    (
      typeof error?.message === "string" &&
      /Could not find the function .*appuntamento_sicuro/i.test(error.message)
    );
}

function hasCustomerMinimumNotice(date: Date): boolean {
  return !Number.isNaN(date.getTime()) && date.getTime() - Date.now() >= CUSTOMER_MIN_NOTICE_MS;
}

async function getAppointmentMailUser(idUtente: number): Promise<AppointmentMailUser | null> {
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

async function getAppointmentMailServiceByAppointmentId(
  idAppuntamento: number,
  fallbackNote: string | null
): Promise<AppointmentMailService | null> {
  const { data: relations, error: relationError } = await db
    .from("appuntamentiservizi")
    .select("idServizio")
    .eq("idAppuntamento", idAppuntamento)
    .limit(1);

  if (relationError) {
    throw relationError;
  }

  const relation = Array.isArray(relations) ? relations[0] : null;
  const serviceId = Number(relation?.idServizio);

  if (!Number.isFinite(serviceId) || serviceId <= 0) {
    return fallbackNote ? { idServizio: 0, nome: fallbackNote } : null;
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

async function buildAppointmentMailPayload(appointment: Appuntamento): Promise<AppointmentMailPayload | null> {
  if (!appointment.idCliente) {
    return null;
  }

  const cliente = await getAppointmentMailUser(appointment.idCliente);

  if (!cliente?.email) {
    return null;
  }

  const operatore = await getAppointmentMailUser(appointment.idOperatore);
  const servizio = await getAppointmentMailServiceByAppointmentId(
    appointment.idAppuntamento,
    appointment.note
  );

  return {
    cliente,
    operatore,
    servizio,
    dataOraInizio: appointment.dataOraInizio,
    dataOraFine: appointment.dataOraFine
  };
}

async function createAppointmentFallback(payload: {
  idCliente: number | null;
  idOperatore: number;
  idServizio?: number | null;
  prezzoPersonalizzato?: number | null;
  durataPersonalizzata?: number | null;
  dataOraInizio: string;
  dataOraFine: string;
  stato?: string | null;
  note?: string | null;
}): Promise<Appuntamento | null> {
  const start = new Date(payload.dataOraInizio);
  const end = new Date(payload.dataOraFine);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Date appuntamento non valide");
  }

  const minimumEnd = new Date(start);
  minimumEnd.setMinutes(minimumEnd.getMinutes() + 30);
  const guardedEnd = end < minimumEnd ? minimumEnd : end;

  const { data: overlappingAppointments, error: overlapError } = await db
    .from("appuntamenti")
    .select("idAppuntamento, dataOraInizio, dataOraFine")
    .eq("idOperatore", payload.idOperatore)
    .lt("dataOraInizio", guardedEnd.toISOString())
    .gt("dataOraFine", payload.dataOraInizio);

  if (overlapError) {
    throw overlapError;
  }

  if ((overlappingAppointments || []).length > 0) {
    return null;
  }

  const { data: createdAppointment, error: appointmentError } = await db
    .from("appuntamenti")
    .insert({
      idCliente: payload.idCliente,
      idOperatore: payload.idOperatore,
      dataOraInizio: payload.dataOraInizio,
      dataOraFine: payload.dataOraFine,
      stato: payload.stato || "prenotato",
      note: payload.note || null
    })
    .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
    .single();

  if (appointmentError) {
    throw appointmentError;
  }

  const appointment = createdAppointment as Appuntamento | null;

  if (!appointment) {
    return null;
  }

  if (payload.idServizio) {
    const relationPayload: Record<string, number | null> = {
      idAppuntamento: appointment.idAppuntamento,
      idServizio: payload.idServizio
    };

    if (payload.prezzoPersonalizzato != null) {
      relationPayload.prezzoPersonalizzato = payload.prezzoPersonalizzato;
    }

    if (payload.durataPersonalizzata != null) {
      relationPayload.durataPersonalizzata = payload.durataPersonalizzata;
    }

    let { error: relationError } = await db
      .from("appuntamentiservizi")
      .insert(relationPayload);

    if (relationError && isMissingAppointmentServiceOverrideColumnError(relationError)) {
      const retry = await db
        .from("appuntamentiservizi")
        .insert({
          idAppuntamento: appointment.idAppuntamento,
          idServizio: payload.idServizio
        });
      relationError = retry.error;
    }

    if (relationError) {
      await db
        .from("appuntamenti")
        .delete()
        .eq("idAppuntamento", appointment.idAppuntamento);

      throw relationError;
    }
  }

  return {
    ...appointment,
    idServizio: payload.idServizio ?? null,
    servizioNome: payload.note ?? null
  };
}

async function createBlankStaffSlot(payload: {
  idOperatore: number;
  dataOraInizio: string;
  dataOraFine: string;
  note?: string | null;
}): Promise<Appuntamento | null> {
  const start = new Date(payload.dataOraInizio);
  const end = new Date(payload.dataOraFine);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("Date riserva non valide");
  }

  const minimumEnd = new Date(start);
  minimumEnd.setMinutes(minimumEnd.getMinutes() + 30);
  const guardedEnd = end < minimumEnd ? minimumEnd : end;

  const { data: overlappingAppointments, error: overlapError } = await db
    .from("appuntamenti")
    .select("idAppuntamento, dataOraInizio, dataOraFine")
    .eq("idOperatore", payload.idOperatore)
    .lt("dataOraInizio", guardedEnd.toISOString())
    .gt("dataOraFine", payload.dataOraInizio);

  if (overlapError) {
    throw overlapError;
  }

  if ((overlappingAppointments || []).length > 0) {
    return null;
  }

  const { data, error } = await db
    .from("appuntamenti")
    .insert({
      idCliente: null,
      idOperatore: payload.idOperatore,
      dataOraInizio: payload.dataOraInizio,
      dataOraFine: payload.dataOraFine,
      stato: null,
      note: payload.note || null
    })
    .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
    .single();

  if (error) {
    throw error;
  }

  return {
    ...(data as Appuntamento),
    idServizio: null,
    servizioNome: null
  };
}

async function updateAppointmentServiceOverrides(
  idAppuntamento: number,
  prezzoPersonalizzato?: number | null,
  durataPersonalizzata?: number | null
): Promise<void> {
  if (prezzoPersonalizzato == null && durataPersonalizzata == null) {
    return;
  }

  const payload: Record<string, number | null> = {};

  if (prezzoPersonalizzato != null) {
    payload.prezzoPersonalizzato = prezzoPersonalizzato;
  }

  if (durataPersonalizzata != null) {
    payload.durataPersonalizzata = durataPersonalizzata;
  }

  const { error } = await db
    .from("appuntamentiservizi")
    .update(payload)
    .eq("idAppuntamento", idAppuntamento);

  if (error && !isMissingAppointmentServiceOverrideColumnError(error)) {
    throw error;
  }
}

router.get("/count", async (req: Request, res: Response) => {
  try {
    const data = (req.query.data as string)?.trim();

    if (!data) {
      return res.status(400).json({ message: "La data e obbligatoria" });
    }

    const startOfDay = `${data}T00:00:00`;
    const endOfDay = `${data}T23:59:59`;

    const { count, error } = await db
      .from("appuntamenti")
      .select("idAppuntamento", { count: "exact", head: true })
      .gte("dataOraInizio", startOfDay)
      .lte("dataOraInizio", endOfDay);

    if (error) {
      throw error;
    }

    return res.json({ totale: count ?? 0 });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const idOperatoreNum = parseInt(req.query.idOperatore as string, 10);
    if (isNaN(idOperatoreNum)) {
      return res.status(400).json({ message: "idOperatore non valido" });
    }

    const { data, error } = await db
      .from("appuntamenti")
      .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
      .eq("idOperatore", idOperatoreNum);

    if (error) {
      throw error;
    }

    const appointments = (data || []) as Appuntamento[];
    const appointmentIds = appointments.map((item) => item.idAppuntamento);

    if (appointmentIds.length === 0) {
      return res.json({ appuntamenti: appointments });
    }

    let { data: relations, error: relationsError } = await db
      .from("appuntamentiservizi")
      .select("idAppuntamento, idServizio, durataPersonalizzata")
      .in("idAppuntamento", appointmentIds);

    if (relationsError) {
      if (!isMissingAppointmentServiceOverrideColumnError(relationsError)) {
        throw relationsError;
      }

      const fallbackRelations = await db
        .from("appuntamentiservizi")
        .select("idAppuntamento, idServizio")
        .in("idAppuntamento", appointmentIds);

      if (fallbackRelations.error) {
        throw fallbackRelations.error;
      }

      relations = fallbackRelations.data as any;
    }

    const serviceIds = Array.from(
      new Set((relations || []).map((relation: any) => Number(relation.idServizio)).filter(Number.isFinite))
    );

    const servicesById = new Map<number, string>();

    if (serviceIds.length > 0) {
      const { data: services, error: servicesError } = await db
        .from("servizi")
        .select("idServizio, nome")
        .in("idServizio", serviceIds);

      if (servicesError) {
        throw servicesError;
      }

      (services || []).forEach((service: any) => {
        servicesById.set(Number(service.idServizio), String(service.nome || ""));
      });
    }

    const relationByAppointmentId = new Map<number, any>();
    (relations || []).forEach((relation: any) => {
      const appointmentId = Number(relation.idAppuntamento);
      const serviceId = Number(relation.idServizio);

      if (Number.isFinite(appointmentId) && Number.isFinite(serviceId)) {
        relationByAppointmentId.set(appointmentId, relation);
      }
    });

    const appointmentsWithServices = appointments.map((appointment) => {
      const relation = relationByAppointmentId.get(appointment.idAppuntamento);
      const serviceId = relation ? Number(relation.idServizio) : null;

      return {
        ...appointment,
        idServizio: serviceId,
        servizioNome: serviceId ? servicesById.get(serviceId) ?? null : appointment.note,
        durataPersonalizzata: relation?.durataPersonalizzata != null ? Number(relation.durataPersonalizzata) : null
      };
    });

    return res.json({ appuntamenti: appointmentsWithServices });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.post("/", verifyToken, async (req: any, res: Response) => {
  try {
    const authenticatedUserId = req.user?.userId;
    const userRole = req.user?.ruolo;
    const {
      idCliente: requestedClienteId,
      idOperatore,
      idServizio,
      dataOraInizio,
      dataOraFine,
      stato,
      note,
      prezzoPersonalizzato,
      durataPersonalizzata
    } = req.body;

    if (!authenticatedUserId) {
      return res.status(401).json({ message: "Utente non autenticato" });
    }

    const requestedClienteIdNumber = Number(requestedClienteId);
    const idCliente = isStaffRole(userRole) && Number.isFinite(requestedClienteIdNumber) && requestedClienteIdNumber > 0
      ? requestedClienteIdNumber
      : authenticatedUserId;

    if (!idOperatore || !dataOraInizio || !dataOraFine) {
      return res.status(400).json({
        message: "idOperatore, dataOraInizio e dataOraFine sono obbligatori"
      });
    }

    if (!isStaffRole(userRole) && !hasCustomerMinimumNotice(new Date(dataOraInizio))) {
      return res.status(409).json({ message: CUSTOMER_MIN_NOTICE_MESSAGE });
    }

    const { data: cliente, error: clienteError } = await db
      .from("utenti")
      .select("idUtente, nome, cognome, email")
      .eq("idUtente", idCliente)
      .maybeSingle();

    if (clienteError) {
      throw clienteError;
    }

    if (!cliente?.email) {
      return res.status(400).json({
        message: "Email del cliente non disponibile"
      });
    }

    const { data: operatore, error: operatoreError } = await db
      .from("utenti")
      .select("idUtente, nome, cognome, email")
      .eq("idUtente", idOperatore)
      .maybeSingle();

    if (operatoreError) {
      throw operatoreError;
    }

    let servizio: AppointmentMailService | null = null;

    if (idServizio) {
      const { data: servizioData, error: servizioError } = await db
        .from("servizi")
        .select("idServizio, nome, prezzo")
        .eq("idServizio", idServizio)
        .maybeSingle();

      if (servizioError) {
        throw servizioError;
      }

      servizio = (servizioData as AppointmentMailService | null) ?? null;
    }

    const normalizedEndDateTime = normalizeEndDateTime(dataOraInizio, dataOraFine);
    let { data, error: createAppointmentError } = await db
      .rpc("create_appuntamento_sicuro", {
        p_id_cliente: idCliente,
        p_id_operatore: idOperatore,
        p_data_ora_inizio: dataOraInizio,
        p_data_ora_fine: normalizedEndDateTime,
        p_id_servizio: idServizio || null,
        p_stato: stato || "prenotato",
        p_note: note || null
      })
      .single();

    if (createAppointmentError) {
      if (isMissingRpcError(createAppointmentError)) {

        data = await createAppointmentFallback({
          idCliente,
          idOperatore,
          idServizio: idServizio || null,
          prezzoPersonalizzato: Number.isFinite(Number(prezzoPersonalizzato)) ? Number(prezzoPersonalizzato) : null,
          durataPersonalizzata: Number.isFinite(Number(durataPersonalizzata)) ? Number(durataPersonalizzata) : null,
          dataOraInizio,
          dataOraFine: normalizedEndDateTime,
          stato: stato || "prenotato",
          note: note || null
        });
        createAppointmentError = null;
      }
    }

    if (createAppointmentError) {
      if (isAppointmentConflictError(createAppointmentError)) {
        return res.status(409).json({
          message: "L'operatore non e disponibile per tutta la durata del servizio selezionato"
        });
      }

      throw createAppointmentError;
    }

    if (!data) {
      return res.status(409).json({
        message: "L'operatore non e disponibile per tutta la durata del servizio selezionato"
      });
    }

    await updateAppointmentServiceOverrides(
      Number((data as any).idAppuntamento),
      Number.isFinite(Number(prezzoPersonalizzato)) ? Number(prezzoPersonalizzato) : null,
      Number.isFinite(Number(durataPersonalizzata)) ? Number(durataPersonalizzata) : null
    );

    sendMailInBackground("Errore invio mail conferma appuntamento", () =>
      sendAppointmentConfirmationEmail({
        cliente: cliente as AppointmentMailUser,
        operatore: (operatore as AppointmentMailUser | null) ?? null,
        servizio: servizio ?? (note ? { idServizio: Number(idServizio || 0), nome: String(note) } : null),
        dataOraInizio,
        dataOraFine: normalizedEndDateTime
      })
    );

    return res.status(201).json(data);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.post("/slot-vuoto", verifyToken, async (req: any, res: Response) => {
  try {
    const userRole = req.user?.ruolo;
    const idOperatore = Number(req.body?.idOperatore);
    const dataOraInizio = String(req.body?.dataOraInizio ?? "").trim();
    const dataOraFine = normalizeEndDateTime(
      dataOraInizio,
      String(req.body?.dataOraFine ?? "").trim()
    );
    const note = req.body?.note ? String(req.body.note).trim() : null;

    if (!isTitolareRole(userRole)) {
      return res.status(403).json({ message: "Solo i titolari possono riservare slot vuoti" });
    }

    if (!Number.isFinite(idOperatore) || idOperatore <= 0 || !dataOraInizio || !dataOraFine) {
      return res.status(400).json({
        message: "idOperatore, dataOraInizio e dataOraFine sono obbligatori"
      });
    }

    const { data: operatore, error: operatoreError } = await db
      .from("utenti")
      .select("idUtente, ruolo")
      .eq("idUtente", idOperatore)
      .in("ruolo", ["titolare", "operatore"])
      .maybeSingle();

    if (operatoreError) {
      throw operatoreError;
    }

    if (!operatore) {
      return res.status(404).json({ message: "Operatore non trovato" });
    }

    const slot = await createBlankStaffSlot({
      idOperatore,
      dataOraInizio,
      dataOraFine,
      note
    });

    if (!slot) {
      return res.status(409).json({
        message: "Lo slot selezionato si sovrappone a un appuntamento esistente"
      });
    }

    return res.status(201).json(slot);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.put("/:idAppuntamento", verifyToken, async (req: any, res: Response) => {
  try {
    const idAppuntamento = parseInt(req.params.idAppuntamento, 10);
    const userId = req.user?.userId;
    const userRole = req.user?.ruolo;

    if (isNaN(idAppuntamento)) {
      return res.status(400).json({ message: "idAppuntamento non valido" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Utente non autenticato" });
    }

    const { data: existingAppointment, error: existingAppointmentError } = await db
      .from("appuntamenti")
      .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
      .eq("idAppuntamento", idAppuntamento)
      .maybeSingle();

    if (existingAppointmentError) {
      throw existingAppointmentError;
    }

    if (!existingAppointment) {
      return res.status(404).json({ message: "Appuntamento non trovato" });
    }

    const canManageAllAppointments = isStaffRole(userRole);
    const isAppointmentOwner = existingAppointment.idCliente === userId;

    if (!canManageAllAppointments && !isAppointmentOwner) {
      return res.status(403).json({ message: "Non autorizzato a modificare questo appuntamento" });
    }

    const appointmentStart = new Date(existingAppointment.dataOraInizio);
    if (!canManageAllAppointments && !hasCustomerMinimumNotice(appointmentStart)) {
      return res.status(409).json({ message: CUSTOMER_MIN_NOTICE_MESSAGE });
    }

    const nextStart = req.body?.dataOraInizio || existingAppointment.dataOraInizio;
    const nextEnd = req.body?.dataOraFine || existingAppointment.dataOraFine;
    const hasServiceInPayload = Object.prototype.hasOwnProperty.call(req.body ?? {}, "idServizio");
    const nextServiceId = hasServiceInPayload ? Number(req.body?.idServizio) : null;
    const requestedDuration = Number(req.body?.durataPersonalizzata);
    const durataPersonalizzata = Number.isFinite(requestedDuration) && requestedDuration > 0
      ? Math.trunc(requestedDuration)
      : null;
    const normalizedEndDateTime = normalizeEndDateTime(nextStart, nextEnd);

    if (!canManageAllAppointments && !hasCustomerMinimumNotice(new Date(nextStart))) {
      return res.status(409).json({ message: CUSTOMER_MIN_NOTICE_MESSAGE });
    }

    const { data, error: updateAppointmentError } = await db
      .rpc("update_appuntamento_sicuro", {
        p_id_appuntamento: idAppuntamento,
        p_data_ora_inizio: nextStart,
        p_data_ora_fine: normalizedEndDateTime,
        p_stato: req.body?.stato || existingAppointment.stato || "prenotato",
        p_note: req.body?.note ?? null,
        p_update_servizio: hasServiceInPayload,
        p_id_servizio: hasServiceInPayload && Number.isFinite(nextServiceId) ? nextServiceId : null
      })
      .single();

    if (updateAppointmentError) {
      if (isAppointmentConflictError(updateAppointmentError)) {
        return res.status(409).json({
          message: "L'operatore non e disponibile per tutta la durata del servizio selezionato"
        });
      }

      throw updateAppointmentError;
    }

    if (!data) {
      return res.status(409).json({
        message: "L'operatore non e disponibile per tutta la durata del servizio selezionato"
      });
    }

    if (
      existingAppointment.dataOraInizio !== nextStart ||
      existingAppointment.dataOraFine !== normalizedEndDateTime
    ) {
      const { error: reminderResetError } = await db
        .from("notifiche_email_appuntamenti")
        .delete()
        .eq("idAppuntamento", idAppuntamento)
        .eq("tipo", "email_reminder_24h");

      if (reminderResetError) {
      }
    }

    if (hasServiceInPayload || Object.prototype.hasOwnProperty.call(req.body ?? {}, "durataPersonalizzata")) {
      await updateAppointmentServiceOverrides(
        idAppuntamento,
        null,
        durataPersonalizzata
      );
    }

    sendMailInBackground("Errore invio mail aggiornamento appuntamento", async () => {
      const mailPayload = await buildAppointmentMailPayload(data as Appuntamento);

      if (mailPayload) {
        await sendAppointmentUpdatedEmail(mailPayload);
      }
    });

    return res.json(data as Appuntamento);
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete("/:idAppuntamento", verifyToken, async (req: any, res: Response) => {
  try {
    const idAppuntamento = parseInt(req.params.idAppuntamento, 10);
    const userId = req.user?.userId;
    const userRole = req.user?.ruolo;

    if (isNaN(idAppuntamento)) {
      return res.status(400).json({ message: "idAppuntamento non valido" });
    }

    if (!userId) {
      return res.status(401).json({ message: "Utente non autenticato" });
    }

    const { data: appointment, error: appointmentError } = await db
      .from("appuntamenti")
      .select("idAppuntamento, idCliente, idOperatore, dataOraInizio, dataOraFine, stato, note")
      .eq("idAppuntamento", idAppuntamento)
      .maybeSingle();

    if (appointmentError) {
      throw appointmentError;
    }

    if (!appointment) {
      return res.status(404).json({ message: "Appuntamento non trovato" });
    }

    const canManageAllAppointments = isStaffRole(userRole);
    const isAppointmentOwner = appointment.idCliente === userId;

    if (!canManageAllAppointments && !isAppointmentOwner) {
      return res.status(403).json({ message: "Non autorizzato a eliminare questo appuntamento" });
    }

    const appointmentStart = new Date(appointment.dataOraInizio);
    if (!canManageAllAppointments && appointment.idCliente && !hasCustomerMinimumNotice(appointmentStart)) {
      return res.status(409).json({ message: CUSTOMER_MIN_NOTICE_MESSAGE });
    }

    let mailPayload: AppointmentMailPayload | null = null;

    try {
      mailPayload = await buildAppointmentMailPayload(appointment as Appuntamento);
    } catch (mailPayloadError) {
    }

    const { error: reminderCleanupError } = await db
      .from("notifiche_email_appuntamenti")
      .delete()
      .eq("idAppuntamento", idAppuntamento);

    if (reminderCleanupError) {
    }

    const { error: servicesCleanupError } = await db
      .from("appuntamentiservizi")
      .delete()
      .eq("idAppuntamento", idAppuntamento);

    if (servicesCleanupError) {
      throw servicesCleanupError;
    }

    const { error } = await db
      .from("appuntamenti")
      .delete()
      .eq("idAppuntamento", idAppuntamento);

    if (error) {
      throw error;
    }

    sendMailInBackground("Errore invio mail eliminazione appuntamento", async () => {
      if (mailPayload) {
        await sendAppointmentCancelledEmail(mailPayload);
      }
    });

    return res.json({ message: "Appuntamento eliminato con successo" });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

export default router;
