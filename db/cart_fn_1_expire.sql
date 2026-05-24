DROP FUNCTION IF EXISTS public.expire_cart_reservations();

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

GRANT EXECUTE ON FUNCTION public.expire_cart_reservations() TO service_role;
