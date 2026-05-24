-- 1) Esegui prima questo file in Supabase.
-- Contiene solo tabelle, indici e RLS: non ci sono funzioni AS $$.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cart_sessions (
  "idCart" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idUtente" integer NULL REFERENCES public.utenti ("idUtente") ON DELETE SET NULL,
  "expiresAt" timestamp without time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "createdAt" timestamp without time zone NOT NULL DEFAULT timezone('Europe/Rome', now()),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT timezone('Europe/Rome', now())
);

CREATE TABLE IF NOT EXISTS public.cart_items (
  "idCart" uuid NOT NULL REFERENCES public.cart_sessions ("idCart") ON DELETE CASCADE,
  "idProdotto" integer NOT NULL REFERENCES public.prodotti ("idProdotto") ON DELETE CASCADE,
  "quantita" integer NOT NULL CHECK ("quantita" > 0),
  "prezzoUnitario" numeric(10, 2) NOT NULL DEFAULT 0,
  "createdAt" timestamp without time zone NOT NULL DEFAULT timezone('Europe/Rome', now()),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT timezone('Europe/Rome', now()),
  PRIMARY KEY ("idCart", "idProdotto")
);

ALTER TABLE public.cart_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cart_sessions_active_expiry
  ON public.cart_sessions ("status", "expiresAt");

CREATE INDEX IF NOT EXISTS idx_cart_items_product
  ON public.cart_items ("idProdotto");
