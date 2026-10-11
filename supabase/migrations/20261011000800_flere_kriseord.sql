-- KirkePulsen: flere indirekte kriseuttrykk.
-- Kjørt mot Supabase-prosjektet "Broen" (esjmuewxbhrbcgktxiis) 11.10.2026.
--
-- En test 11.10.2026 viste at «Jeg har løpt løpet ut. Jeg vil sovne inn!» ikke ble merket.
-- Listen utvides med indirekte uttrykk. Det gir noen feilmerkinger (f.eks. «mamma sovnet inn»),
-- men en merking presten ser er uskadelig, mens en som glipper kan være alvorlig.
-- Samme liste ligger i mobil/App.js (KRISEORD), så hjelpenumrene vises med en gang.

insert into public.kriseord (uttrykk) values
  ('sovne inn'), ('sovner inn'), ('løpt løpet ut'), ('ikke våkne'), ('slippe å våkne'),
  ('slutt på alt'), ('slippe å leve'), ('bli borte for alltid'), ('forsvinne for alltid'),
  ('orker ikke lenger'), ('orker ikke livet'), ('gi opp livet'), ('gir opp livet'),
  ('ikke verdt å leve'), ('ingen vits å leve'), ('ingen vits i å leve'),
  ('ingen mening med livet'), ('livet har ingen mening'), ('lei av å leve'), ('lei av livet'),
  ('trett av livet'), ('trøtt av livet'), ('ikke være her lenger'), ('vil ikke være her'),
  ('jeg var død'), ('jeg hadde vært død'), ('henge meg'), ('skjære meg'), ('ta mitt liv')
on conflict (uttrykk) do nothing;

-- Merk eksisterende innspill på nytt etter den utvidede listen (bare fra usann til sann).
update public.innspill i
set krise = true
where not i.krise
  and exists (select 1 from public.kriseord k
              where position(k.uttrykk in lower(i.svar_tekst)) > 0);
