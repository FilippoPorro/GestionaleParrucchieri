-- Permette di salvare prezzo e durata personalizzati per un servizio dentro un appuntamento.
-- Esegui questo file nel SQL editor di Supabase prima di usare gli override dal gestionale.

ALTER TABLE public.appuntamentiservizi
  ADD COLUMN IF NOT EXISTS "prezzoPersonalizzato" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "durataPersonalizzata" integer;
