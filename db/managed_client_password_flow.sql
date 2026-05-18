-- Flusso clienti creati dal gestionale:
-- password temporanea generata dal backend e cambio obbligatorio al primo accesso.
-- Esegui questo script nel SQL editor di Supabase.

alter table public.utenti
  add column if not exists "resetPasswordToken" text,
  add column if not exists "resetPasswordExpires" timestamptz,
  add column if not exists "mustChangePassword" boolean not null default false;
