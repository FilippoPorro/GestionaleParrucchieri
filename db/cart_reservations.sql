-- Esegui questo file nel SQL editor di Supabase per attivare il carrello con prenotazione stock.
-- Non usare il fix automatico "enable RLS" di Supabase: le righe RLS sono gia presenti qui sotto.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cart_sessions (
  "idCart" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idUtente" integer NULL REFERENCES public.utenti ("idUtente") ON DELETE SET NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cart_items (
  "idCart" uuid NOT NULL REFERENCES public.cart_sessions ("idCart") ON DELETE CASCADE,
  "idProdotto" integer NOT NULL REFERENCES public.prodotti ("idProdotto") ON DELETE CASCADE,
  "quantita" integer NOT NULL CHECK ("quantita" > 0),
  "prezzoUnitario" numeric(10, 2) NOT NULL DEFAULT 0,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("idCart", "idProdotto")
);

ALTER TABLE public.cart_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cart_sessions_active_expiry
  ON public.cart_sessions ("status", "expiresAt");

CREATE INDEX IF NOT EXISTS idx_cart_items_product
  ON public.cart_items ("idProdotto");

DROP FUNCTION IF EXISTS public.expire_cart_reservations();
DROP FUNCTION IF EXISTS public.reserve_cart_item_sicuro(uuid, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.complete_reserved_cart_checkout_sicuro(uuid, integer, numeric);

CREATE OR REPLACE FUNCTION public.expire_cart_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count integer;
BEGIN
  DELETE FROM public.cart_sessions
  WHERE "status" = 'active'
    AND "expiresAt" <= timezone('Europe/Rome', now());

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;
  RETURN v_expired_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_cart_item_sicuro(
  p_cart_id uuid,
  p_id_utente integer,
  p_product_id integer,
  p_qty integer,
  p_ttl_minutes integer DEFAULT 10
)
RETURNS TABLE ("cartId" uuid, "expiresAt" timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart_id uuid;
  v_expires_at timestamp with time zone;
  v_stock integer;
  v_reserved_by_others integer;
  v_unit_price numeric(10, 2);
  v_existing_user_id integer;
BEGIN
  IF p_product_id IS NULL OR p_product_id <= 0 OR p_qty IS NULL OR p_qty < 0 THEN
    RAISE EXCEPTION 'invalid_cart_item' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.expire_cart_reservations();
  PERFORM pg_advisory_xact_lock(hashtextextended('products:stock:' || p_product_id::text, 0));

  IF p_cart_id IS NOT NULL THEN
    SELECT cs."idUtente"
    INTO v_existing_user_id
    FROM public.cart_sessions cs
    WHERE cs."idCart" = p_cart_id
      AND cs."status" = 'active'
      AND cs."expiresAt" > now();

    IF FOUND AND v_existing_user_id IS DISTINCT FROM p_id_utente THEN
      RAISE EXCEPTION 'cart_owner_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT p."quantitaMagazzino", p."prezzoRivendita"
  INTO v_stock, v_unit_price
  FROM public.prodotti p
  WHERE p."idProdotto" = p_product_id;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(ci."quantita"), 0)::integer
  INTO v_reserved_by_others
  FROM public.cart_items ci
  INNER JOIN public.cart_sessions cs ON cs."idCart" = ci."idCart"
  WHERE ci."idProdotto" = p_product_id
    AND cs."status" = 'active'
    AND cs."expiresAt" > now()
    AND (p_cart_id IS NULL OR ci."idCart" <> p_cart_id);

  IF p_qty > v_stock - v_reserved_by_others THEN
    RAISE EXCEPTION 'stock_insufficiente' USING ERRCODE = 'P0001';
  END IF;

  v_cart_id := COALESCE(p_cart_id, gen_random_uuid());
  v_expires_at := now() + make_interval(mins => GREATEST(COALESCE(p_ttl_minutes, 10), 1));

  INSERT INTO public.cart_sessions ("idCart", "idUtente", "expiresAt", "status", "updatedAt")
  VALUES (v_cart_id, p_id_utente, v_expires_at, 'active', now())
  ON CONFLICT ("idCart") DO UPDATE
    SET
      "idUtente" = COALESCE(EXCLUDED."idUtente", public.cart_sessions."idUtente"),
      "expiresAt" = EXCLUDED."expiresAt",
      "status" = 'active',
      "updatedAt" = now();

  IF p_qty = 0 THEN
    DELETE FROM public.cart_items
    WHERE public.cart_items."idCart" = v_cart_id
      AND public.cart_items."idProdotto" = p_product_id;

    DELETE FROM public.cart_sessions
    WHERE public.cart_sessions."idCart" = v_cart_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.cart_items ci
        WHERE ci."idCart" = v_cart_id
      );
  ELSE
    INSERT INTO public.cart_items ("idCart", "idProdotto", "quantita", "prezzoUnitario", "updatedAt")
    VALUES (v_cart_id, p_product_id, p_qty, COALESCE(v_unit_price, 0), now())
    ON CONFLICT ("idCart", "idProdotto") DO UPDATE
      SET
        "quantita" = EXCLUDED."quantita",
        "prezzoUnitario" = EXCLUDED."prezzoUnitario",
        "updatedAt" = now();
  END IF;

  RETURN QUERY SELECT v_cart_id AS "cartId", v_expires_at AS "expiresAt";
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_reserved_cart_checkout_sicuro(
  p_cart_id uuid,
  p_id_cliente integer,
  p_total numeric
)
RETURNS TABLE ("idVendita" integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_updated_count integer;
  v_id_vendita integer;
BEGIN
  IF p_cart_id IS NULL THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;

  IF p_total IS NULL OR p_total <= 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.expire_cart_reservations();

  IF NOT EXISTS (
    SELECT 1
    FROM public.cart_sessions cs
    WHERE cs."idCart" = p_cart_id
      AND cs."status" = 'active'
      AND cs."expiresAt" > now()
  ) THEN
    RAISE EXCEPTION 'cart_expired' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cart_items ci
    WHERE ci."idCart" = p_cart_id
  ) THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT ci."idProdotto" AS product_id, ci."quantita" AS qty
    FROM public.cart_items ci
    WHERE ci."idCart" = p_cart_id
    ORDER BY ci."idProdotto"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('products:stock:' || v_item.product_id::text, 0));
  END LOOP;

  INSERT INTO public.vendite ("idCliente", "data", "totale")
  VALUES (p_id_cliente, now(), p_total)
  RETURNING public.vendite."idVendita" INTO v_id_vendita;

  FOR v_item IN
    SELECT
      ci."idProdotto" AS product_id,
      ci."quantita" AS qty,
      ci."prezzoUnitario" AS prezzo_unitario
    FROM public.cart_items ci
    WHERE ci."idCart" = p_cart_id
    ORDER BY ci."idProdotto"
  LOOP
    UPDATE public.prodotti
    SET "quantitaMagazzino" = "quantitaMagazzino" - v_item.qty
    WHERE "idProdotto" = v_item.product_id
      AND "quantitaMagazzino" >= v_item.qty;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
      RAISE EXCEPTION 'stock_insufficiente' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public."dettagliovenditaProdotti" (
      "idVendita",
      "idProdotto",
      "quantita",
      "prezzoUnitario"
    )
    VALUES (
      v_id_vendita,
      v_item.product_id,
      v_item.qty,
      v_item.prezzo_unitario
    );
  END LOOP;

  DELETE FROM public.cart_sessions
  WHERE "idCart" = p_cart_id;

  RETURN QUERY SELECT v_id_vendita AS "idVendita";
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_cart_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_cart_item_sicuro(uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_reserved_cart_checkout_sicuro(uuid, integer, numeric) TO service_role;
