-- Permette di salvare prezzo e durata personalizzati per un servizio dentro un appuntamento.
-- Esegui questo file nel SQL editor di Supabase prima di usare gli override dal gestionale.

ALTER TABLE public.appuntamentiservizi
  ADD COLUMN IF NOT EXISTS "prezzoPersonalizzato" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "durataPersonalizzata" integer;

COMMENT ON COLUMN public.appuntamentiservizi."prezzoPersonalizzato"
  IS 'Prezzo applicato solo a questo servizio dentro questo appuntamento. Se NULL usa servizi.prezzo.';

COMMENT ON COLUMN public.appuntamentiservizi."durataPersonalizzata"
  IS 'Durata in minuti applicata solo a questo servizio dentro questo appuntamento. Se NULL usa servizi.durata.';
