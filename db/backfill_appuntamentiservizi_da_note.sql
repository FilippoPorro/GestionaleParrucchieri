-- Collega i vecchi appuntamenti ai servizi usando la nota solo per riparare i dati storici.
-- Dopo questo backfill, la cassa legge sempre:
-- appuntamenti.idAppuntamento -> appuntamentiservizi.idServizio -> servizi.prezzo.
-- Da eseguire su Supabase SQL editor.

INSERT INTO public.appuntamentiservizi ("idAppuntamento", "idServizio")
SELECT
  a."idAppuntamento",
  s."idServizio"
FROM public.appuntamenti a
JOIN public.servizi s
  ON lower(trim(a.note)) = lower(trim(s.nome))
WHERE a.note IS NOT NULL
  AND trim(a.note) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.appuntamentiservizi aps
    WHERE aps."idAppuntamento" = a."idAppuntamento"
  );
