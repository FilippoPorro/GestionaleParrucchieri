-- Aggiunge il campo sesso agli utenti Supabase.
-- Valori ammessi: m, f.

alter table public.utenti
  add column if not exists sesso text;

update public.utenti
set sesso = case
  when lower(trim(sesso)) in ('m', 'maschio', 'mascio') then 'm'
  when lower(trim(sesso)) in ('f', 'femmina') then 'f'
  else null
end
where sesso is not null;

alter table public.utenti
  drop constraint if exists utenti_sesso_check;

alter table public.utenti
  add constraint utenti_sesso_check
  check (sesso is null or sesso in ('m', 'f'));

notify pgrst, 'reload schema';
