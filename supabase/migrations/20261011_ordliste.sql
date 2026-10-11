-- KirkePulsen: ordliste som stopper hatefulle og nedverdigende ord i innspill og tilbakemeldinger.
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- Bevisst smal liste: bare ord som nesten alltid brukes for å såre andre.
-- Vanlig banning (f.eks. «faen», «helvete») er IKKE med. Folk som har det vondt banner,
-- og et rop om hjelp skal aldri stoppes av filteret.
--
-- Listen ligger i en egen tabell, så den kan endres i Supabase-dashbordet uten ny kode.
-- Bare administrator (service_role) kan lese og endre den – ikke appen eller prester.

create table if not exists public.blokkert_ord (
  ord        text primary key check (ord = lower(ord) and length(ord) > 1),
  kommentar  text,
  created_at timestamptz default now()
);
alter table public.blokkert_ord enable row level security;
revoke all on public.blokkert_ord from anon, authenticated;
grant all on public.blokkert_ord to service_role;

insert into public.blokkert_ord (ord, kommentar) values
  ('neger', 'rasistisk'), ('negre', 'rasistisk'), ('negeren', 'rasistisk'), ('nigger', 'rasistisk'),
  ('pakkis', 'rasistisk'), ('pakkiser', 'rasistisk'),
  ('svarting', 'rasistisk'), ('svartinger', 'rasistisk'),
  ('sandneger', 'rasistisk'), ('sandnegre', 'rasistisk'),
  ('sigøynerpakk', 'rasistisk'), ('jødesvin', 'antisemittisk'),
  ('hestkuk', 'nedverdigende'), ('rævpuler', 'nedverdigende'), ('rævkjører', 'nedverdigende')
on conflict (ord) do nothing;

-- Sjekker teksten mot listen. Hele ord, uavhengig av store/små bokstaver.
-- security definer: funksjonen kan lese listen selv om den som sender ikke kan det.
create or replace function public.sjekk_blokkerte_ord()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rad jsonb := to_jsonb(new);  -- gjør at samme funksjon virker for begge tabellene
  tekst text;
  treff text;
begin
  tekst := lower(coalesce(rad->>'svar_tekst', rad->>'melding', ''));

  select b.ord into treff
  from public.blokkert_ord b
  where tekst ~ ('(^|[^[:alnum:]æøå])' || b.ord || '($|[^[:alnum:]æøå])')
  limit 1;

  if treff is not null then
    -- Ordet selv avsløres ikke i feilmeldingen.
    raise exception 'innspill_avvist_ordliste'
      using errcode = 'P0001',
            hint = 'Teksten inneholder ord som ikke er tillatt.';
  end if;
  return new;
end;
$$;

revoke execute on function public.sjekk_blokkerte_ord() from public, anon, authenticated;

drop trigger if exists sjekk_ord_innspill on public.innspill;
create trigger sjekk_ord_innspill
  before insert or update of svar_tekst on public.innspill
  for each row execute function public.sjekk_blokkerte_ord();

drop trigger if exists sjekk_ord_tilbakemelding on public.generell_tilbakemelding;
create trigger sjekk_ord_tilbakemelding
  before insert or update of melding on public.generell_tilbakemelding
  for each row execute function public.sjekk_blokkerte_ord();
