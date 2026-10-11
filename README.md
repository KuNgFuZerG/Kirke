# KirkePulsen

En bro mellom menighet og prest. Menigheten svarer på prestens spørsmål før gudstjenesten,
uten navn, og presten leser svarene på en egen side.

KirkePulsen er en prototype som senere skal bli en modul i Broen.

## Hva ligger hvor

| Mappe / fil | Hva det er |
|---|---|
| `admin.html`, `assets/` | Prestens side. Publiseres automatisk på GitHub Pages: <https://kungfuzerg.github.io/Kirke/admin.html> |
| `mobil/` | Menighetsappen (Expo / React Native). Selve appen er `mobil/App.js`. |
| `supabase/migrations/` | Alle endringer i databasen, i rekkefølge. Allerede kjørt mot Supabase-prosjektet «Broen». |

Både prestens side og appen bruker Supabase-prosjektet **«Broen»** (`esjmuewxbhrbcgktxiis`).
Ikke bruk prosjektet «Broen - første».

## Starte appen på egen PC

Krever Node.js. Første gang:

```powershell
git clone https://github.com/KuNgFuZerG/Kirke.git
cd Kirke\mobil
npm install
```

Hver gang:

```powershell
cd Kirke\mobil
npx.cmd expo start
```

- Trykk `w` for å åpne appen i nettleseren.
- Skann QR-koden med kameraet på iPhonen for å åpne den i **Expo Go** (samme wifi som PC-en).

Nye pakker legges alltid til med `npx.cmd expo install <pakke>`, ikke `npm install`,
slik at versjonene passer med Expo.

## Sikkerhet og personvern, kort

- Tilgang styres av databasen (RLS). Bare brukere i tabellen `prest` kan lese innspill,
  og bare for sine egne menigheter.
- Innspill lagres uten navn. Avsenderen kan få svar fra presten via en hemmelig nøkkel som
  bare ligger på avsenderens telefon.
- Innspill som tyder på krise merkes for presten, og appen viser hjelpetelefoner med en gang.
- Innspill slettes automatisk hver natt etter reglene i tabellen `lagringsregler`
  (3 måneder etter gudstjenesten, 12 måneder etter arkivering).
- Spam begrenses per gudstjeneste, uten å lagre noe om hvem som sender.
