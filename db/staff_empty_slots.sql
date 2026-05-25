-- Consente ai titolari di bloccare fasce orarie senza associare cliente, servizio, note o stato.
-- Esegui questo file nel SQL editor di Supabase se la colonna idCliente e ancora NOT NULL.

ALTER TABLE public.appuntamenti
  ALTER COLUMN "idCliente" DROP NOT NULL,
  ALTER COLUMN "stato" DROP NOT NULL;
