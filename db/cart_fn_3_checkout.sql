DROP FUNCTION IF EXISTS public.complete_reserved_cart_checkout_sicuro(uuid, integer, numeric);

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
      AND cs."expiresAt" > timezone('Europe/Rome', now())
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

GRANT EXECUTE ON FUNCTION public.complete_reserved_cart_checkout_sicuro(uuid, integer, numeric) TO service_role;
