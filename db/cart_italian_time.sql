-- Esegui questo file una sola volta se le tabelle carrello esistono gia.
-- Converte gli orari del carrello in timestamp locali Europe/Rome, visibili in Supabase come ora italiana.

ALTER TABLE public.cart_sessions
  ALTER COLUMN "expiresAt" TYPE timestamp without time zone USING "expiresAt" AT TIME ZONE 'Europe/Rome',
  ALTER COLUMN "createdAt" TYPE timestamp without time zone USING "createdAt" AT TIME ZONE 'Europe/Rome',
  ALTER COLUMN "updatedAt" TYPE timestamp without time zone USING "updatedAt" AT TIME ZONE 'Europe/Rome',
  ALTER COLUMN "createdAt" SET DEFAULT timezone('Europe/Rome', now()),
  ALTER COLUMN "updatedAt" SET DEFAULT timezone('Europe/Rome', now());

ALTER TABLE public.cart_items
  ALTER COLUMN "createdAt" TYPE timestamp without time zone USING "createdAt" AT TIME ZONE 'Europe/Rome',
  ALTER COLUMN "updatedAt" TYPE timestamp without time zone USING "updatedAt" AT TIME ZONE 'Europe/Rome',
  ALTER COLUMN "createdAt" SET DEFAULT timezone('Europe/Rome', now()),
  ALTER COLUMN "updatedAt" SET DEFAULT timezone('Europe/Rome', now());
