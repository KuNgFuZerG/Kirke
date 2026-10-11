-- KirkePulsen: én prest kan høre til flere menigheter (vanlig i Den norske kirke,
-- f.eks. Høvåg og Lillesand sokn med felles stab).
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.

-- 1) Slett ubrukt duplikat av "Høvåg kirke". Sjekket på forhånd: ingen gudstjenester,
--    tilbakemeldinger eller prester peker på denne raden, og den brukes ikke i koden.
delete from public.menighet
where id = '44f18d7f-a18d-4c05-92c2-6f4ff39f4091'
  and not exists (select 1 from public.gudstjeneste where menighet_id = '44f18d7f-a18d-4c05-92c2-6f4ff39f4091')
  and not exists (select 1 from public.generell_tilbakemelding where menighet_id = '44f18d7f-a18d-4c05-92c2-6f4ff39f4091')
  and not exists (select 1 from public.prest where menighet_id = '44f18d7f-a18d-4c05-92c2-6f4ff39f4091');

-- 2) Prestelisten: én rad per (prest, menighet) i stedet for én rad per prest.
--    Tilgangsreglene trenger ingen endring – de spør allerede
--    "finnes det en rad for denne brukeren OG denne menigheten?".
alter table public.prest drop constraint prest_pkey;
alter table public.prest add primary key (user_id, menighet_id);
create index if not exists prest_menighet_id_idx on public.prest (menighet_id);
