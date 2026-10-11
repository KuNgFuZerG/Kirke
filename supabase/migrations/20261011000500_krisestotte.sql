-- KirkePulsen: krisestøtte.
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- 1. Innspill som tyder på krise (selvmordstanker, selvskading o.l.) merkes automatisk,
--    så presten ser dem først. De blir ALDRI stoppet – bare merket.
-- 2. Presten kan arkivere innspill for å ta vare på dem.
-- 3. Presten kan svare avsenderen uten at avsenderen mister anonymiteten:
--    appen lager en hemmelig nøkkel som bare ligger på avsenderens telefon. Databasen lagrer
--    bare et fingeravtrykk (sha256) av nøkkelen, så heller ikke presten eller administrator
--    kan bruke den til å finne avsenderen. Bare den som har nøkkelen, kan hente svaret.
--
-- Merk: innspill om selvmord og selvskading er helseopplysninger. Hvor lenge arkiverte
-- innspill skal lagres, må bestemmes før appen tas i bruk av en ekte menighet.

-- ---------------------------------------------------------------- kriseord
create table if not exists public.kriseord (
  uttrykk    text primary key check (uttrykk = lower(uttrykk) and length(uttrykk) > 3),
  created_at timestamptz default now()
);
alter table public.kriseord enable row level security;
revoke all on public.kriseord from anon, authenticated;
grant all on public.kriseord to service_role;

-- Delstrenger: «selvmord» treffer også «selvmordstanker». Heller for mange merkinger enn for få.
insert into public.kriseord (uttrykk) values
  ('selvmord'), ('suicid'), ('ta livet av meg'), ('ta livet mitt'), ('tar livet av meg'),
  ('ta mitt eget liv'), ('ende livet'), ('avslutte livet'), ('gjøre slutt på livet'),
  ('vil ikke leve'), ('ikke vil leve'), ('orker ikke å leve'), ('orker ikke leve'),
  ('vil dø'), ('ønsker å dø'), ('lyst til å dø'), ('bedre om jeg var død'), ('bedre uten meg'),
  ('skade meg selv'), ('skader meg selv'), ('selvskad'), ('kutte meg'), ('kutter meg'),
  ('overdose'), ('ingen grunn til å leve'), ('orker ikke mer')
on conflict (uttrykk) do nothing;

-- ---------------------------------------------------------------- nye kolonner på innspill
alter table public.innspill
  add column if not exists krise            boolean     not null default false,
  add column if not exists arkivert_at      timestamptz,
  add column if not exists svar_nokkel      text,   -- tømmes alltid av triggeren under
  add column if not exists svar_nokkel_hash text;

create index if not exists innspill_svar_nokkel_hash_idx on public.innspill (svar_nokkel_hash);

-- Kjøres før et nytt innspill lagres: merker krise, gjør nøkkelen om til fingeravtrykk,
-- og sørger for at avsenderen ikke selv kan sette krise/arkiv-feltene.
create or replace function public.forbered_innspill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.krise := exists (
    select 1 from public.kriseord k
    where position(k.uttrykk in lower(coalesce(new.svar_tekst, ''))) > 0
  );
  new.arkivert_at := null;
  if new.svar_nokkel is not null and length(new.svar_nokkel) >= 32 then
    new.svar_nokkel_hash := encode(sha256(convert_to(new.svar_nokkel, 'UTF8')), 'hex');
  else
    new.svar_nokkel_hash := null;
  end if;
  new.svar_nokkel := null;
  return new;
end;
$$;
revoke execute on function public.forbered_innspill() from public, anon, authenticated;

create trigger forbered_innspill
  before insert on public.innspill
  for each row execute function public.forbered_innspill();

-- ---------------------------------------------------------------- arkivering
-- Prester kan bare endre arkiv-feltet, ingenting annet i innspillet.
grant update (arkivert_at) on public.innspill to authenticated;

create policy "prest_arkiverer_innspill" on public.innspill
  for update to authenticated
  using (exists (select 1 from public.gudstjeneste g
                 join public.prest p on p.menighet_id = g.menighet_id
                 where g.id = innspill.gudstjeneste_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.gudstjeneste g
                 join public.prest p on p.menighet_id = g.menighet_id
                 where g.id = innspill.gudstjeneste_id and p.user_id = (select auth.uid())));

-- ---------------------------------------------------------------- prestens svar
create table if not exists public.prest_svar (
  id              uuid primary key default gen_random_uuid(),
  innspill_id     uuid not null references public.innspill(id) on delete cascade,
  tekst           text not null check (length(btrim(tekst)) between 1 and 2000),
  sendt_tidspunkt timestamptz not null default now(),
  sendt_av        uuid references auth.users(id) on delete set null default auth.uid()
);
create index if not exists prest_svar_innspill_idx on public.prest_svar (innspill_id);
alter table public.prest_svar enable row level security;
revoke all on public.prest_svar from anon, authenticated;
grant select, insert, delete on public.prest_svar to authenticated;
grant all on public.prest_svar to service_role;

create policy "prest_ser_svar" on public.prest_svar
  for select to authenticated
  using (exists (select 1 from public.innspill i
                 join public.gudstjeneste g on g.id = i.gudstjeneste_id
                 join public.prest p on p.menighet_id = g.menighet_id
                 where i.id = prest_svar.innspill_id and p.user_id = (select auth.uid())));

create policy "prest_sender_svar" on public.prest_svar
  for insert to authenticated
  with check (sendt_av = (select auth.uid()) and exists (
                 select 1 from public.innspill i
                 join public.gudstjeneste g on g.id = i.gudstjeneste_id
                 join public.prest p on p.menighet_id = g.menighet_id
                 where i.id = prest_svar.innspill_id and p.user_id = (select auth.uid())
                   and i.svar_nokkel_hash is not null));

create policy "prest_sletter_svar" on public.prest_svar
  for delete to authenticated
  using (exists (select 1 from public.innspill i
                 join public.gudstjeneste g on g.id = i.gudstjeneste_id
                 join public.prest p on p.menighet_id = g.menighet_id
                 where i.id = prest_svar.innspill_id and p.user_id = (select auth.uid())));

-- Avsenderen henter svar ved å vise frem nøklene sine. Uten riktig nøkkel får man ingenting.
-- Nøklene er tilfeldige UUID-er (122 bit), så de kan ikke gjettes.
create or replace function public.hent_svar(nokler text[])
returns table (nokkel text, innspill_tekst text, svar_tekst text, svar_tidspunkt timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.nokkel, i.svar_tekst, s.tekst, s.sendt_tidspunkt
  from unnest(nokler[1:50]) as k(nokkel)
  join public.innspill i
    on i.svar_nokkel_hash = encode(sha256(convert_to(k.nokkel, 'UTF8')), 'hex')
  join public.prest_svar s on s.innspill_id = i.id
  where length(k.nokkel) >= 32
  order by s.sendt_tidspunkt;
$$;
revoke execute on function public.hent_svar(text[]) from public;
grant execute on function public.hent_svar(text[]) to anon, authenticated;
