-- Rinomina il ruolo admin in titolare nel database Supabase.
-- Esegui questo file nel SQL editor prima di pubblicare il codice aggiornato.

DO $$
DECLARE
  role_data_type text;
  role_udt_name text;
  role_type_schema text;
  has_admin_value boolean;
  has_titolare_value boolean;
  role_constraint record;
  should_restore_role_check boolean := false;
BEGIN
  SELECT c.data_type, c.udt_name
  INTO role_data_type, role_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'utenti'
    AND c.column_name = 'ruolo';

  FOR role_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'utenti'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%ruolo%'
  LOOP
    should_restore_role_check := true;
    EXECUTE format(
      'ALTER TABLE public.utenti DROP CONSTRAINT %I',
      role_constraint.conname
    );
  END LOOP;

  IF role_data_type = 'USER-DEFINED' THEN
    SELECT n.nspname
    INTO role_type_schema
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = role_udt_name;

    SELECT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = role_type_schema
        AND t.typname = role_udt_name
        AND e.enumlabel = 'admin'
    )
    INTO has_admin_value;

    SELECT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = role_type_schema
        AND t.typname = role_udt_name
        AND e.enumlabel = 'titolare'
    )
    INTO has_titolare_value;

    IF has_admin_value AND NOT has_titolare_value THEN
      EXECUTE format(
        'ALTER TYPE %I.%I RENAME VALUE %L TO %L',
        role_type_schema,
        role_udt_name,
        'admin',
        'titolare'
      );
    ELSIF has_titolare_value THEN
      EXECUTE 'UPDATE public.utenti SET ruolo = ''titolare'' WHERE lower(ruolo::text) = ''admin''';
    END IF;
  ELSE
    UPDATE public.utenti
    SET ruolo = 'titolare'
    WHERE lower(ruolo::text) = 'admin';

    IF should_restore_role_check THEN
      ALTER TABLE public.utenti
        ADD CONSTRAINT utenti_ruolo_check
        CHECK (lower(ruolo::text) IN ('cliente', 'operatore', 'titolare', 'salone'));
    END IF;
  END IF;
END $$;
