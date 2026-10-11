-- KirkePulsen: tilgangsregler (RLS) for menighet og prest
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- Prinsipp:
--   * Alle (også uinnloggede i appen) kan se menigheter og gudstjenester,
--     og sende inn innspill/tilbakemeldinger.
--   * Bare en innlogget bruker som står i tabellen `prest` for riktig menighet
--     kan lese innspill og opprette/endre gudstjenester i sin egen menighet.
--   * Å være "innlogget" alene gir INGEN ekstra tilgang.

-- 1) Fjern farlige standardrettigheter (TRUNCATE går forbi RLS og kan tømme tabeller)
revoke all on public.menighet, public.gudstjeneste, public.innspill, public.generell_tilbakemelding
  from anon, authenticated;

-- service_role (brukes av Supabase-dashbordet og server-kode) får full tilgang
grant all on public.menighet, public.gudstjeneste, public.innspill, public.generell_tilbakemelding
  to service_role;

-- 2) Presteliste: kobler en innlogget bruker til én menighet
create table if not exists public.prest (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  menighet_id uuid not null references public.menighet(id) on delete cascade,
  navn        text,
  created_at  timestamptz default now()
);
alter table public.prest enable row level security;
revoke all on public.prest from anon, authenticated;
grant select on public.prest to authenticated;
grant all on public.prest to service_role;

-- En prest kan bare se sin egen rad (brukes av admin-siden for å finne menigheten)
create policy "prest_ser_egen_rad" on public.prest
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 3) menighet: alle kan lese
grant select on public.menighet to anon, authenticated;
create policy "alle_leser_menighet" on public.menighet
  for select to anon, authenticated
  using (true);

-- 4) gudstjeneste: alle kan lese, prest i menigheten kan opprette/endre/slette
grant select on public.gudstjeneste to anon, authenticated;
grant insert, update, delete on public.gudstjeneste to authenticated;

create policy "alle_leser_gudstjeneste" on public.gudstjeneste
  for select to anon, authenticated
  using (true);

create policy "prest_oppretter_gudstjeneste" on public.gudstjeneste
  for insert to authenticated
  with check (exists (select 1 from public.prest p
                      where p.user_id = (select auth.uid()) and p.menighet_id = gudstjeneste.menighet_id));

create policy "prest_endrer_gudstjeneste" on public.gudstjeneste
  for update to authenticated
  using      (exists (select 1 from public.prest p
                      where p.user_id = (select auth.uid()) and p.menighet_id = gudstjeneste.menighet_id))
  with check (exists (select 1 from public.prest p
                      where p.user_id = (select auth.uid()) and p.menighet_id = gudstjeneste.menighet_id));

create policy "prest_sletter_gudstjeneste" on public.gudstjeneste
  for delete to authenticated
  using (exists (select 1 from public.prest p
                 where p.user_id = (select auth.uid()) and p.menighet_id = gudstjeneste.menighet_id));

-- 5) innspill: alle kan sende inn til en eksisterende gudstjeneste, bare prest i menigheten kan lese/slette
grant insert on public.innspill to anon, authenticated;
grant select, delete on public.innspill to authenticated;

create policy "alle_sender_innspill" on public.innspill
  for insert to anon, authenticated
  with check (exists (select 1 from public.gudstjeneste g where g.id = innspill.gudstjeneste_id));

create policy "prest_leser_innspill" on public.innspill
  for select to authenticated
  using (exists (select 1 from public.gudstjeneste g
                 join public.prest p on p.menighet_id = g.menighet_id
                 where g.id = innspill.gudstjeneste_id and p.user_id = (select auth.uid())));

create policy "prest_sletter_innspill" on public.innspill
  for delete to authenticated
  using (exists (select 1 from public.gudstjeneste g
                 join public.prest p on p.menighet_id = g.menighet_id
                 where g.id = innspill.gudstjeneste_id and p.user_id = (select auth.uid())));

-- 6) generell_tilbakemelding: samme mønster som innspill
grant insert on public.generell_tilbakemelding to anon, authenticated;
grant select, delete on public.generell_tilbakemelding to authenticated;

create policy "alle_sender_tilbakemelding" on public.generell_tilbakemelding
  for insert to anon, authenticated
  with check (exists (select 1 from public.menighet m where m.id = generell_tilbakemelding.menighet_id));

create policy "prest_leser_tilbakemelding" on public.generell_tilbakemelding
  for select to authenticated
  using (exists (select 1 from public.prest p
                 where p.user_id = (select auth.uid()) and p.menighet_id = generell_tilbakemelding.menighet_id));

create policy "prest_sletter_tilbakemelding" on public.generell_tilbakemelding
  for delete to authenticated
  using (exists (select 1 from public.prest p
                 where p.user_id = (select auth.uid()) and p.menighet_id = generell_tilbakemelding.menighet_id));

-- 7) Steng den interne funksjonen rls_auto_enable() for API-et.
--    Den brukes av en database-trigger (ensure_rls), som fortsatt virker uten disse rettighetene.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
