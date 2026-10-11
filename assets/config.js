/**
 * KirkePulsen – felles oppsett for Supabase.
 *
 * Publishable-nøkkelen er laget for å ligge i nettsider og apper. Sikkerheten ligger i
 * tilgangsreglene i databasen (se supabase/migrations/), ikke i at nøkkelen er hemmelig.
 *
 * Når KirkePulsen flyttes inn i Broen, er dette den eneste filen som må peke på
 * Broens Supabase-prosjekt.
 */
window.KIRKEPULSEN_CONFIG = Object.freeze({
  // Prosjektet "Broen" (esjmuewxbhrbcgktxiis). Ikke bruk "Broen - første".
  supabaseUrl: 'https://esjmuewxbhrbcgktxiis.supabase.co',
  supabaseKey: 'sb_publishable_A3k2xBiT15N4S9NPunqHoA_Mn8Xskxk',

  // Hvor lenge før gudstjenesten svarfristen normalt settes.
  svarfristTimerFor: 24,
  // Standard klokkeslett for nye gudstjenester.
  standardKlokkeslett: { time: 11, minutt: 0 },
});
