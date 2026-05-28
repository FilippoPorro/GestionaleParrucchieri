-- Esegui questo file nel SQL editor di Supabase prima di pubblicare il sito.
-- Le funzioni sotto proteggono appuntamenti e checkout anche con piu istanze server online.

CREATE INDEX IF NOT EXISTS idx_appuntamenti_operatore_periodo
  ON public.appuntamenti ("idOperatore", "dataOraInizio", "dataOraFine");

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

CREATE INDEX IF NOT EXISTS idx_cart_sessions_active_expiry
  ON public.cart_sessions ("status", "expiresAt");

CREATE INDEX IF NOT EXISTS idx_cart_items_product
  ON public.cart_items ("idProdotto");

DROP FUNCTION IF EXISTS public.create_appuntamento_sicuro(
  integer,
  integer,
  timestamp without time zone,
  timestamp without time zone,
  integer,
  text,
  text
);

DROP FUNCTION IF EXISTS public.update_appuntamento_sicuro(
  integer,
  timestamp without time zone,
  timestamp without time zone,
  text,
  text,
  boolean,
  integer
);

DROP FUNCTION IF EXISTS public.decrement_product_stock_sicuro(jsonb);
DROP FUNCTION IF EXISTS public.complete_checkout_sicuro(integer, numeric, jsonb);
DROP FUNCTION IF EXISTS public.complete_management_checkout_sicuro(integer, integer, integer, text, numeric, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.expire_cart_reservations();
DROP FUNCTION IF EXISTS public.reserve_cart_item_sicuro(uuid, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.complete_reserved_cart_checkout_sicuro(uuid, integer, numeric);

CREATE OR REPLACE FUNCTION public.create_appuntamento_sicuro(
  p_id_cliente integer,
  p_id_operatore integer,
  p_data_ora_inizio timestamp without time zone,
  p_data_ora_fine timestamp without time zone,
  p_id_servizio integer DEFAULT NULL,
  p_stato text DEFAULT 'prenotato',
  p_note text DEFAULT NULL
)
RETURNS SETOF public.appuntamenti
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id_appuntamento integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('appointments:operator:' || p_id_operatore::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.appuntamenti a
    WHERE a."idOperatore" = p_id_operatore
      AND p_data_ora_inizio < GREATEST(a."dataOraFine", a."dataOraInizio" + interval '30 minutes')
      AND GREATEST(p_data_ora_fine, p_data_ora_inizio + interval '30 minutes') > a."dataOraInizio"
  ) THEN
    RAISE EXCEPTION 'operator_unavailable' USING ERRCODE = 'P0001';
  END IF;

  EXECUTE
    'INSERT INTO public.appuntamenti (
      "idCliente",
      "idOperatore",
      "dataOraInizio",
      "dataOraFine",
      "stato",
      "note"
    )
    VALUES ($1, $2, $3, $4, ' || quote_nullable(COALESCE(p_stato, 'prenotato')) || ', $5)
    RETURNING "idAppuntamento"'
  INTO v_id_appuntamento
  USING p_id_cliente, p_id_operatore, p_data_ora_inizio, p_data_ora_fine, p_note;

  IF p_id_servizio IS NOT NULL THEN
    INSERT INTO public.appuntamentiservizi ("idAppuntamento", "idServizio")
    VALUES (v_id_appuntamento, p_id_servizio);
  END IF;

  RETURN QUERY
    SELECT a.*
    FROM public.appuntamenti a
    WHERE a."idAppuntamento" = v_id_appuntamento;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_appuntamento_sicuro(
  p_id_appuntamento integer,
  p_data_ora_inizio timestamp without time zone,
  p_data_ora_fine timestamp without time zone,
  p_stato text,
  p_note text,
  p_update_servizio boolean DEFAULT false,
  p_id_servizio integer DEFAULT NULL
)
RETURNS SETOF public.appuntamenti
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id_operatore integer;
BEGIN
  SELECT a."idOperatore"
  INTO v_id_operatore
  FROM public.appuntamenti a
  WHERE a."idAppuntamento" = p_id_appuntamento;

  IF v_id_operatore IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('appointments:operator:' || v_id_operatore::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.appuntamenti a
    WHERE a."idOperatore" = v_id_operatore
      AND a."idAppuntamento" <> p_id_appuntamento
      AND p_data_ora_inizio < GREATEST(a."dataOraFine", a."dataOraInizio" + interval '30 minutes')
      AND GREATEST(p_data_ora_fine, p_data_ora_inizio + interval '30 minutes') > a."dataOraInizio"
  ) THEN
    RAISE EXCEPTION 'operator_unavailable' USING ERRCODE = 'P0001';
  END IF;

  EXECUTE
    'UPDATE public.appuntamenti
    SET
      "dataOraInizio" = $1,
      "dataOraFine" = $2,
      "stato" = ' || quote_nullable(COALESCE(p_stato, 'prenotato')) || ',
      "note" = $3
    WHERE "idAppuntamento" = $4'
  USING p_data_ora_inizio, p_data_ora_fine, p_note, p_id_appuntamento;

  IF p_update_servizio THEN
    DELETE FROM public.appuntamentiservizi
    WHERE "idAppuntamento" = p_id_appuntamento;

    IF p_id_servizio IS NOT NULL THEN
      INSERT INTO public.appuntamentiservizi ("idAppuntamento", "idServizio")
      VALUES (p_id_appuntamento, p_id_servizio);
    END IF;
  END IF;

  RETURN QUERY
    SELECT a.*
    FROM public.appuntamenti a
    WHERE a."idAppuntamento" = p_id_appuntamento;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_product_stock_sicuro(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_updated_count integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT
      (item->>'productId')::integer AS product_id,
      SUM((item->>'qty')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) item
    GROUP BY (item->>'productId')::integer
    ORDER BY (item->>'productId')::integer
  LOOP
    IF v_item.product_id IS NULL OR v_item.qty IS NULL OR v_item.qty <= 0 THEN
      RAISE EXCEPTION 'invalid_cart_item' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('products:stock:' || v_item.product_id::text, 0));
  END LOOP;

  FOR v_item IN
    SELECT
      (item->>'productId')::integer AS product_id,
      SUM((item->>'qty')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) item
    GROUP BY (item->>'productId')::integer
    ORDER BY (item->>'productId')::integer
  LOOP
    UPDATE public.prodotti
    SET "quantitaMagazzino" = "quantitaMagazzino" - v_item.qty
    WHERE "idProdotto" = v_item.product_id
      AND "quantitaMagazzino" >= v_item.qty;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
      IF EXISTS (SELECT 1 FROM public.prodotti WHERE "idProdotto" = v_item.product_id) THEN
        RAISE EXCEPTION 'stock_insufficiente' USING ERRCODE = 'P0001';
      END IF;

      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END;
$$;

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
RETURNS TABLE ("cartId" uuid, "expiresAt" timestamp without time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart_id uuid;
  v_expires_at timestamp without time zone;
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
      AND cs."expiresAt" > timezone('Europe/Rome', now());

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
    AND cs."expiresAt" > timezone('Europe/Rome', now())
    AND (p_cart_id IS NULL OR ci."idCart" <> p_cart_id);

  IF p_qty > v_stock - v_reserved_by_others THEN
    RAISE EXCEPTION 'stock_insufficiente' USING ERRCODE = 'P0001';
  END IF;

  v_cart_id := COALESCE(p_cart_id, gen_random_uuid());
  v_expires_at := timezone('Europe/Rome', now()) + make_interval(mins => GREATEST(COALESCE(p_ttl_minutes, 10), 1));

  INSERT INTO public.cart_sessions ("idCart", "idUtente", "expiresAt", "status", "updatedAt")
  VALUES (v_cart_id, p_id_utente, v_expires_at, 'active', timezone('Europe/Rome', now()))
  ON CONFLICT ("idCart") DO UPDATE
    SET
      "idUtente" = COALESCE(EXCLUDED."idUtente", public.cart_sessions."idUtente"),
      "expiresAt" = EXCLUDED."expiresAt",
      "status" = 'active',
      "updatedAt" = timezone('Europe/Rome', now());

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
    VALUES (v_cart_id, p_product_id, p_qty, COALESCE(v_unit_price, 0), timezone('Europe/Rome', now()))
    ON CONFLICT ("idCart", "idProdotto") DO UPDATE
      SET
        "quantita" = EXCLUDED."quantita",
        "prezzoUnitario" = EXCLUDED."prezzoUnitario",
        "updatedAt" = timezone('Europe/Rome', now());
  END IF;

  RETURN QUERY SELECT v_cart_id AS "cartId", v_expires_at AS "expiresAt";
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_checkout_sicuro(
  p_id_cliente integer,
  p_total numeric,
  p_items jsonb
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
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;

  IF p_total IS NULL OR p_total <= 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT
      (item->>'productId')::integer AS product_id,
      SUM((item->>'qty')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) item
    GROUP BY (item->>'productId')::integer
    ORDER BY (item->>'productId')::integer
  LOOP
    IF v_item.product_id IS NULL OR v_item.qty IS NULL OR v_item.qty <= 0 THEN
      RAISE EXCEPTION 'invalid_cart_item' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('products:stock:' || v_item.product_id::text, 0));
  END LOOP;

  INSERT INTO public.vendite ("idCliente", "data", "totale")
  VALUES (COALESCE(p_id_cliente, -1), now(), p_total)
  RETURNING public.vendite."idVendita" INTO v_id_vendita;

  FOR v_item IN
    SELECT
      (item->>'productId')::integer AS product_id,
      SUM((item->>'qty')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) item
    GROUP BY (item->>'productId')::integer
    ORDER BY (item->>'productId')::integer
  LOOP
    UPDATE public.prodotti
    SET "quantitaMagazzino" = "quantitaMagazzino" - v_item.qty
    WHERE "idProdotto" = v_item.product_id
      AND "quantitaMagazzino" >= v_item.qty;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
      IF EXISTS (SELECT 1 FROM public.prodotti WHERE "idProdotto" = v_item.product_id) THEN
        RAISE EXCEPTION 'stock_insufficiente' USING ERRCODE = 'P0001';
      END IF;

      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public."dettagliovenditaProdotti" (
    "idVendita",
    "idProdotto",
    "quantita",
    "prezzoUnitario"
  )
  SELECT
    v_id_vendita,
    (item->>'productId')::integer,
    SUM((item->>'qty')::integer)::integer,
    MAX((item->>'prezzoUnitario')::numeric)
  FROM jsonb_array_elements(p_items) item
  GROUP BY (item->>'productId')::integer;

  RETURN QUERY SELECT v_id_vendita;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_management_checkout_sicuro(
  p_id_cliente integer,
  p_id_operatore integer,
  p_id_appuntamento integer,
  p_metodo text,
  p_total numeric,
  p_product_items jsonb,
  p_service_items jsonb
)
RETURNS TABLE ("idVendita" integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_item record;
  v_service_item record;
  v_updated_count integer;
  v_id_vendita integer;
  v_expected_total numeric(10, 2) := 0;
BEGIN
  IF p_total IS NULL OR p_total < 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = 'P0001';
  END IF;

  IF p_metodo IS NULL OR p_metodo NOT IN ('contanti', 'carta') THEN
    RAISE EXCEPTION 'invalid_payment_method' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_service_items, '[]'::jsonb)), 0) > 0
    AND (p_id_operatore IS NULL OR p_id_operatore <= 0) THEN
    RAISE EXCEPTION 'operator_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_product_items IS NOT NULL AND jsonb_typeof(p_product_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_product_items' USING ERRCODE = 'P0001';
  END IF;

  IF p_service_items IS NOT NULL AND jsonb_typeof(p_service_items) <> 'array' THEN
    RAISE EXCEPTION 'invalid_service_items' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(jsonb_array_length(COALESCE(p_product_items, '[]'::jsonb)), 0) = 0
    AND COALESCE(jsonb_array_length(COALESCE(p_service_items, '[]'::jsonb)), 0) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = 'P0001';
  END IF;

  FOR v_product_item IN
    SELECT
      (item->>'productId')::integer AS product_id,
      SUM((item->>'qty')::integer)::integer AS qty,
      MAX((item->>'prezzoUnitario')::numeric) AS prezzo_unitario
    FROM jsonb_array_elements(COALESCE(p_product_items, '[]'::jsonb)) item
    GROUP BY (item->>'productId')::integer
    ORDER BY (item->>'productId')::integer
  LOOP
    IF v_product_item.product_id IS NULL
      OR v_product_item.qty IS NULL
      OR v_product_item.qty <= 0
      OR v_product_item.prezzo_unitario IS NULL
      OR v_product_item.prezzo_unitario < 0 THEN
      RAISE EXCEPTION 'invalid_product_items' USING ERRCODE = 'P0001';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('products:stock:' || v_product_item.product_id::text, 0));
    v_expected_total := v_expected_total + (v_product_item.qty * v_product_item.prezzo_unitario);
  END LOOP;

  FOR v_service_item IN
    SELECT
      (item->>'serviceId')::integer AS service_id,
      MAX((item->>'prezzoUnitario')::numeric) AS prezzo_unitario
    FROM jsonb_array_elements(COALESCE(p_service_items, '[]'::jsonb)) item
    GROUP BY (item->>'serviceId')::integer
    ORDER BY (item->>'serviceId')::integer
  LOOP
    IF v_service_item.service_id IS NULL
      OR v_service_item.service_id <= 0
      OR v_service_item.prezzo_unitario IS NULL
      OR v_service_item.prezzo_unitario < 0 THEN
      RAISE EXCEPTION 'invalid_service_items' USING ERRCODE = 'P0001';
    END IF;

    v_expected_total := v_expected_total + v_service_item.prezzo_unitario;
  END LOOP;

  v_expected_total := ROUND(v_expected_total, 2);

  IF v_expected_total <> ROUND(p_total, 2) THEN
    RAISE EXCEPTION 'invalid_total: totale non coerente con i dettagli' USING ERRCODE = 'P0001';
  END IF;

  IF p_id_appuntamento IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.appuntamenti
      WHERE "idAppuntamento" = p_id_appuntamento
    ) THEN
      RAISE EXCEPTION 'appointment_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_id_operatore IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.utenti
      WHERE "idUtente" = p_id_operatore
    ) THEN
      RAISE EXCEPTION 'operator_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.vendite ("idCliente", "data", "totale")
  VALUES (COALESCE(p_id_cliente, -1), now(), ROUND(p_total, 2))
  RETURNING public.vendite."idVendita" INTO v_id_vendita;

  FOR v_product_item IN
    SELECT
      (item->>'productId')::integer AS product_id,
      SUM((item->>'qty')::integer)::integer AS qty,
      MAX((item->>'prezzoUnitario')::numeric) AS prezzo_unitario
    FROM jsonb_array_elements(COALESCE(p_product_items, '[]'::jsonb)) item
    GROUP BY (item->>'productId')::integer
    ORDER BY (item->>'productId')::integer
  LOOP
    UPDATE public.prodotti
    SET "quantitaMagazzino" = "quantitaMagazzino" - v_product_item.qty
    WHERE "idProdotto" = v_product_item.product_id
      AND "quantitaMagazzino" >= v_product_item.qty;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
      IF EXISTS (SELECT 1 FROM public.prodotti WHERE "idProdotto" = v_product_item.product_id) THEN
        RAISE EXCEPTION 'stock_insufficiente' USING ERRCODE = 'P0001';
      END IF;

      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public."dettagliovenditaProdotti" (
    "idVendita",
    "idProdotto",
    "quantita",
    "prezzoUnitario"
  )
  SELECT
    v_id_vendita,
    (item->>'productId')::integer,
    SUM((item->>'qty')::integer)::integer,
    MAX((item->>'prezzoUnitario')::numeric)
  FROM jsonb_array_elements(COALESCE(p_product_items, '[]'::jsonb)) item
  GROUP BY (item->>'productId')::integer;

  INSERT INTO public."dettaglioVenditaServizi" (
    "idVendita",
    "idServizio",
    "prezzoUnitario",
    "idOperatore",
    "idAppuntamento"
  )
  SELECT
    v_id_vendita,
    (item->>'serviceId')::integer,
    MAX((item->>'prezzoUnitario')::numeric),
    p_id_operatore,
    p_id_appuntamento
  FROM jsonb_array_elements(COALESCE(p_service_items, '[]'::jsonb)) item
  GROUP BY (item->>'serviceId')::integer;

  INSERT INTO public.pagamenti (
    "idVendita",
    "metodo",
    "importo",
    "data"
  )
  VALUES (
    v_id_vendita,
    p_metodo,
    ROUND(p_total, 2),
    now()
  );

  IF p_id_appuntamento IS NOT NULL THEN
    UPDATE public.appuntamenti
    SET "stato" = 'completato'
    WHERE "idAppuntamento" = p_id_appuntamento;
  END IF;

  RETURN QUERY SELECT v_id_vendita;
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
  VALUES (COALESCE(p_id_cliente, -1), now(), p_total)
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

GRANT EXECUTE ON FUNCTION public.create_appuntamento_sicuro(
  integer,
  integer,
  timestamp without time zone,
  timestamp without time zone,
  integer,
  text,
  text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.update_appuntamento_sicuro(
  integer,
  timestamp without time zone,
  timestamp without time zone,
  text,
  text,
  boolean,
  integer
) TO service_role;

GRANT EXECUTE ON FUNCTION public.decrement_product_stock_sicuro(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_checkout_sicuro(integer, numeric, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_management_checkout_sicuro(integer, integer, integer, text, numeric, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_cart_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_cart_item_sicuro(uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_reserved_cart_checkout_sicuro(uuid, integer, numeric) TO service_role;

ALTER TABLE public.cart_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
