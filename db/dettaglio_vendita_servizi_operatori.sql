-- Aggiunge il collegamento operatore/appuntamento ai servizi venduti in cassa.
-- Da eseguire su Supabase SQL editor.

ALTER TABLE public."dettaglioVenditaServizi"
  ADD COLUMN IF NOT EXISTS "idOperatore" integer NULL,
  ADD COLUMN IF NOT EXISTS "idAppuntamento" integer NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dettagliovenditaservizi_idoperatore_fkey'
      AND conrelid = 'public."dettaglioVenditaServizi"'::regclass
  ) THEN
    ALTER TABLE public."dettaglioVenditaServizi"
      ADD CONSTRAINT dettagliovenditaservizi_idoperatore_fkey
      FOREIGN KEY ("idOperatore") REFERENCES public.utenti ("idUtente");
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dettagliovenditaservizi_idappuntamento_fkey'
      AND conrelid = 'public."dettaglioVenditaServizi"'::regclass
  ) THEN
    ALTER TABLE public."dettaglioVenditaServizi"
      ADD CONSTRAINT dettagliovenditaservizi_idappuntamento_fkey
      FOREIGN KEY ("idAppuntamento") REFERENCES public.appuntamenti ("idAppuntamento") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dettagliovenditaservizi_idoperatore
  ON public."dettaglioVenditaServizi" ("idOperatore");

CREATE INDEX IF NOT EXISTS idx_dettagliovenditaservizi_idappuntamento
  ON public."dettaglioVenditaServizi" ("idAppuntamento");
