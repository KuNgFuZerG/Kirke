-- KirkePulsen: databasen avviser innspill etter svarfristen.
-- Før ble fristen bare sjekket i appen, så den kunne omgås ved å kalle API-et direkte.
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- Endrer bare vilkåret i den eksisterende regelen, sletter ingenting.
-- Mangler en gudstjeneste svarfrist (svarfrist er påkrevd, men for sikkerhets skyld),
-- gjelder starttidspunktet som frist.

alter policy "alle_sender_innspill" on public.innspill
  with check (
    exists (
      select 1 from public.gudstjeneste g
      where g.id = innspill.gudstjeneste_id
        and now() <= coalesce(g.svarfrist, g.dato_tid)
    )
  );
