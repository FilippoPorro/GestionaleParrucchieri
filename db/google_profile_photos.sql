-- Salva le immagini profilo Google per mostrarle anche nel gestionale clienti.
-- Esegui questo script nel SQL editor di Supabase.

alter table public.utenti
  add column if not exists "photoURL" text;

