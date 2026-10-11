-- KirkePulsen: lagringstid og automatisk sletting.
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- Regler (avtalt 11.10.2026, kan justeres i lagringsregler-tabellen):
--   * Vanlige innspill:   slettes 3 måneder etter gudstjenesten de gjelder.
--   * Arkiverte innspill: slettes 12 måneder etter at de ble arkivert.
--   * Tilbakemeldinger:   slettes 3 måneder etter at de ble sendt.
--   * Prestens svar slettes sammen med innspillet (on delete cascade).
-- Slettingen gjelder bare databasen. Kopier presten har lastet ned, følger arbeidsgiverens regler.

-- ---------------------------------------------------------------- én kilde til sannhet
create table if not exists public.lagringsregler (
  id                  boolean primary key default true check (id),   -- bare én rad
  innspill_vanlig     interval not null default interval '3 months',
  innspill_arkivert   interval not null default interval '12 months',
  tilbakemelding      interval not null default interval '3 months',
  varsel_for_sletting interval not null default interval '30 days'
);
insert into public.lagringsregler (id) values (true) on conflict (id) do nothing;
alter table public.lagringsregler enable row level security;
revoke all on public.lagringsregler from anon, authenticated;
grant select on public.lagringsregler to authenticated;    -- admin-siden viser reglene
grant all on public.lagringsregler to service_role;
create policy "alle_innloggede_leser_lagringsregler" on public.lagringsregler
  for select to authenticated using (true);

-- Når et innspill slettes, etter reglene over.
create or replace function public.innspill_slettes(i public.innspill)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when i.arkivert_at is not null then i.arkivert_at + r.innspill_arkivert
    else g.dato_tid + r.innspill_vanlig
  end
  from public.lagringsregler r, public.gudstjeneste g
  where g.id = i.gudstjeneste_id;
$$;
-- Brukes som beregnet felt i API-et: select=...,slettes:innspill_slettes
grant execute on function public.innspill_slettes(public.innspill) to authenticated;
revoke execute on function public.innspill_slettes(public.innspill) from public, anon;

-- ---------------------------------------------------------------- selve slettingen
create or replace function public.slett_utlopte()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.lagringsregler;
  ant_innspill int;
  ant_tilbakemeldinger int;
begin
  select * into r from public.lagringsregler;

  delete from public.innspill i
  using public.gudstjeneste g
  where g.id = i.gudstjeneste_id
    and (
      (i.arkivert_at is null     and g.dato_tid    + r.innspill_vanlig   < now()) or
      (i.arkivert_at is not null and i.arkivert_at + r.innspill_arkivert < now())
    );
  get diagnostics ant_innspill = row_count;

  delete from public.generell_tilbakemelding t
  where t.sendt_tidspunkt + r.tilbakemelding < now();
  get diagnostics ant_tilbakemeldinger = row_count;

  return jsonb_build_object('innspill', ant_innspill, 'tilbakemeldinger', ant_tilbakemeldinger, 'kjort', now());
end;
$$;
revoke execute on function public.slett_utlopte() from public, anon, authenticated;

-- Kjør hver natt kl. 03:15 (UTC).
create extension if not exists pg_cron;
select cron.schedule('kirkepulsen-slett-utlopte', '15 3 * * *', $$select public.slett_utlopte()$$);

-- ---------------------------------------------------------------- svar til avsender, med slettedato
-- Ny versjon av hent_svar som også sier når svaret slettes, så appen kan varsle i tide.
create or replace function public.hent_mine_svar(nokler text[])
returns table (nokkel text, innspill_tekst text, svar_tekst text, svar_tidspunkt timestamptz, slettes timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select k.nokkel, i.svar_tekst, s.tekst, s.sendt_tidspunkt, public.innspill_slettes(i)
  from unnest(nokler[1:50]) as k(nokkel)
  join public.innspill i
    on i.svar_nokkel_hash = encode(sha256(convert_to(k.nokkel, 'UTF8')), 'hex')
  join public.prest_svar s on s.innspill_id = i.id
  where length(k.nokkel) >= 32
  order by s.sendt_tidspunkt;
$$;
revoke execute on function public.hent_mine_svar(text[]) from public;
grant execute on function public.hent_mine_svar(text[]) to anon, authenticated;

-- Den gamle hent_svar erstattes av hent_mine_svar. Stengt for API-et (kan fjernes senere).
revoke execute on function public.hent_svar(text[]) from anon, authenticated;
