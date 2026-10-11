-- KirkePulsen: beskyttelse mot spam, uten å lagre noe om hvem som sender.
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- Vanlig spam-beskyttelse begrenser hver avsender (f.eks. via IP-adresse). Det ville
-- svekket anonymiteten, så grensene her gjelder per gudstjeneste/menighet i stedet:
--   * maks 10 innspill i minuttet og 200 i døgnet til samme gudstjeneste
--   * samme tekst til samme gudstjeneste innen en time avvises
--   * maks 2000 tegn (som i appen, nå også i databasen)
-- Tilsvarende for generelle tilbakemeldinger, per menighet.
-- Ulempe: en som spammer kan fylle opp grensen så ekte innspill stoppes en stund.

alter table public.innspill
  add constraint innspill_lengde check (length(svar_tekst) between 1 and 2000) not valid;
alter table public.innspill validate constraint innspill_lengde;

alter table public.generell_tilbakemelding
  add constraint tilbakemelding_lengde check (length(melding) between 1 and 2000) not valid;
alter table public.generell_tilbakemelding validate constraint tilbakemelding_lengde;

create index if not exists innspill_gudstjeneste_tid_idx on public.innspill (gudstjeneste_id, sendt_tidspunkt);
create index if not exists tilbakemelding_menighet_tid_idx on public.generell_tilbakemelding (menighet_id, sendt_tidspunkt);

create or replace function public.begrens_innsending()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  siste_minutt int;
  siste_dogn   int;
  like_tekst   boolean;
begin
  if tg_table_name = 'innspill' then
    -- Lås per gudstjeneste, så samtidige innsendinger telles riktig.
    perform pg_advisory_xact_lock(hashtext('innspill:' || new.gudstjeneste_id::text));

    select count(*) filter (where sendt_tidspunkt > now() - interval '1 minute'),
           count(*)
      into siste_minutt, siste_dogn
      from public.innspill
     where gudstjeneste_id = new.gudstjeneste_id
       and sendt_tidspunkt > now() - interval '1 day';

    select exists (select 1 from public.innspill
                    where gudstjeneste_id = new.gudstjeneste_id
                      and sendt_tidspunkt > now() - interval '1 hour'
                      and lower(btrim(svar_tekst)) = lower(btrim(new.svar_tekst)))
      into like_tekst;

    if siste_minutt >= 10 or siste_dogn >= 200 then
      raise exception 'innspill_avvist_grense' using errcode = 'P0001';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('tilbakemelding:' || new.menighet_id::text));

    select count(*) filter (where sendt_tidspunkt > now() - interval '1 minute'),
           count(*)
      into siste_minutt, siste_dogn
      from public.generell_tilbakemelding
     where menighet_id = new.menighet_id
       and sendt_tidspunkt > now() - interval '1 day';

    select exists (select 1 from public.generell_tilbakemelding
                    where menighet_id = new.menighet_id
                      and sendt_tidspunkt > now() - interval '1 hour'
                      and lower(btrim(melding)) = lower(btrim(new.melding)))
      into like_tekst;

    if siste_minutt >= 10 or siste_dogn >= 100 then
      raise exception 'innspill_avvist_grense' using errcode = 'P0001';
    end if;
  end if;

  if like_tekst then
    raise exception 'innspill_avvist_duplikat' using errcode = 'P0001';
  end if;

  -- Tidspunktet settes alltid av databasen, så grensene ikke kan lures.
  new.sendt_tidspunkt := now();
  return new;
end;
$$;
revoke execute on function public.begrens_innsending() from public, anon, authenticated;

-- Navnet begynner på «a», så denne kjøres før de andre innspill-triggerne.
create trigger a_begrens_innspill
  before insert on public.innspill
  for each row execute function public.begrens_innsending();

create trigger a_begrens_tilbakemelding
  before insert on public.generell_tilbakemelding
  for each row execute function public.begrens_innsending();
