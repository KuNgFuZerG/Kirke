/**
 * KirkePulsen – menighetsappen.
 *
 * Viser neste gudstjeneste i én menighet og lar hvem som helst sende et innspill uten navn
 * innspill til presten. Databasen sørger for at innspill bare kan leses av prester
 * i menigheten (se supabase/migrations/), så appen trenger ingen innlogging.
 *
 * Inndeling:
 *   1. Oppsett
 *   2. Farger og hjelpefunksjoner
 *   3. Data – alle kall mot Supabase samlet ett sted
 *   4. Komponenter
 *   5. Stiler
 *
 * Tilgjengelighet: all tekst skalerer med enhetens skriftstørrelse (ingen faste høyder
 * på tekstbokser), alle trykkflater er minst 48 punkter og har accessibilityRole/-Label,
 * og viktige endringer leses opp for skjermlesere.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createClient } from '@supabase/supabase-js';

// -----------------------------------------------------------------------------
// 1. Oppsett
// -----------------------------------------------------------------------------

// Prosjektet "Broen" (esjmuewxbhrbcgktxiis). Ikke bruk "Broen - første".
const SUPABASE_URL = 'https://esjmuewxbhrbcgktxiis.supabase.co';
// Publishable-nøkkelen er laget for å ligge i apper. Sikkerheten ligger i tilgangsreglene.
const SUPABASE_KEY = 'sb_publishable_A3k2xBiT15N4S9NPunqHoA_Mn8Xskxk';

// Hvilken menighet appen viser. Når appen blir en modul i Broen, kommer denne
// fra brukerens valgte menighet i stedet for å stå fast her.
const MENIGHET_ID = '00517202-3578-480c-9e62-b3469f90c442'; // Høvåg kirke

const MAKS_TEGN = 2000;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }, // appen logger aldri inn
});

// -----------------------------------------------------------------------------
// 2. Farger og hjelpefunksjoner (samme palett som prestens side)
// -----------------------------------------------------------------------------

const farge = {
  kalk: '#F7F8F6',      // bakgrunn
  flate: '#FFFFFF',
  blekk: '#1F2A27',     // tekst – 13.9:1
  dempet: '#4F5C57',    // hjelpetekst – 6.6:1
  gronn: '#2F5D4A',     // knapp – 7.5:1 mot hvit tekst
  gronnLys: '#E6EEEA',
  kant: '#6B7A74',      // feltkant – over 3:1
  feil: '#A3261F',
  feilLys: '#FBECEA',
  ok: '#24563F',
  okLys: '#E5F1EA',
};

/** "søndag 18. oktober kl. 11:00" */
function lesbarDato(iso) {
  const d = new Date(iso);
  const dag = d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });
  const tid = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  return `${dag} kl. ${tid}`;
}

function les(tekst) {
  AccessibilityInfo.announceForAccessibility?.(tekst);
}

// -----------------------------------------------------------------------------
// 3. Data
// -----------------------------------------------------------------------------

const data = {
  /** Neste gudstjeneste i menigheten (inkludert en som startet for under 3 timer siden). */
  async hentNeste(menighetId) {
    const fra = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    return supabase
      .from('gudstjeneste')
      .select('id, tittel, beskrivelse, sporsmal_fra_prest, dato_tid, svarfrist, menighet(navn)')
      .eq('menighet_id', menighetId)
      .gte('dato_tid', fra)
      .order('dato_tid', { ascending: true })
      .limit(1)
      .maybeSingle();
  },

  /** Sender et innspill uten navn. Returnerer bare om det gikk – innspill kan ikke leses tilbake. */
  async sendInnspill(gudstjenesteId, tekst) {
    return supabase.from('innspill').insert([{ gudstjeneste_id: gudstjenesteId, svar_tekst: tekst }]);
  },
};

// -----------------------------------------------------------------------------
// 4. Komponenter
// -----------------------------------------------------------------------------

function Knapp({ tittel, onPress, opptatt = false, deaktivert = false, hint }) {
  const av = deaktivert || opptatt;
  return (
    <Pressable
      onPress={onPress}
      disabled={av}
      accessibilityRole="button"
      accessibilityLabel={tittel}
      accessibilityHint={hint}
      accessibilityState={{ disabled: av, busy: opptatt }}
      style={({ pressed }) => [stil.knapp, pressed && stil.knappTrykket, av && stil.knappAv]}
    >
      {opptatt ? <ActivityIndicator color="#FFFFFF" style={stil.knappSpinner} /> : null}
      <Text style={stil.knappTekst}>{tittel}</Text>
    </Pressable>
  );
}

function Melding({ type, children }) {
  return (
    <View
      style={[stil.melding, type === 'feil' ? stil.meldingFeil : stil.meldingOk]}
      accessibilityRole={type === 'feil' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
    >
      <Text style={[stil.meldingTekst, { color: type === 'feil' ? farge.feil : farge.ok }]}>{children}</Text>
    </View>
  );
}

function SvarSkjema({ gudstjeneste }) {
  const [tekst, setTekst] = useState('');
  const [status, setStatus] = useState('klar'); // klar | sender | sendt | feil
  const [feilmelding, setFeilmelding] = useState('');

  const fristPassert = gudstjeneste.svarfrist && new Date(gudstjeneste.svarfrist) < new Date();

  if (fristPassert) {
    return (
      <Melding type="info">
        Svarfristen for denne gudstjenesten er passert. Du kan svare på neste gudstjeneste når presten har publisert den.
      </Melding>
    );
  }

  if (status === 'sendt') {
    return (
      <View style={stil.takk}>
        <Melding type="ok">Takk. Innspillet ditt er sendt til presten.</Melding>
        <Pressable
          onPress={() => { setTekst(''); setStatus('klar'); }}
          accessibilityRole="button"
          style={stil.lenkeKnapp}
        >
          <Text style={stil.lenkeTekst}>Send et innspill til</Text>
        </Pressable>
      </View>
    );
  }

  async function send() {
    const renTekst = tekst.trim();
    if (!renTekst) {
      setStatus('feil');
      setFeilmelding('Skriv noe før du sender.');
      les('Skriv noe før du sender.');
      return;
    }
    setStatus('sender');
    try {
      const { error } = await data.sendInnspill(gudstjeneste.id, renTekst);
      if (error) throw error;
      setStatus('sendt');
      les('Innspillet ditt er sendt til presten.');
    } catch (err) {
      console.log('[KirkePulsen] Kunne ikke sende innspill:', err?.code, err?.message);
      // 42501: databasen avviste innspillet, normalt fordi svarfristen gikk ut mens appen var åpen.
      const melding = err?.message === 'innspill_avvist_ordliste'
        ? 'Innspillet inneholder ord som ikke er tillatt, og ble ikke sendt. Skriv det gjerne om. Teksten din er tatt vare på.'
        : err?.code === '42501'
        ? 'Svarfristen er passert, så innspillet ble ikke sendt. Du kan svare på neste gudstjeneste når presten har publisert den.'
        : /fetch|network/i.test(err?.message ?? '')
          ? 'Fikk ikke kontakt. Sjekk nettforbindelsen og prøv igjen. Teksten din er tatt vare på.'
          : 'Innspillet ble ikke sendt. Prøv igjen om litt. Teksten din er tatt vare på.';
      setStatus('feil');
      setFeilmelding(melding);
      les(melding);
    }
  }

  const igjen = MAKS_TEGN - tekst.length;

  return (
    <View style={stil.skjema}>
      <Text style={stil.feltTittel} nativeID="svarEtikett">Ditt svar</Text>
      <TextInput
        style={[stil.tekstfelt, status === 'feil' && !tekst.trim() && stil.tekstfeltFeil]}
        multiline
        value={tekst}
        onChangeText={(t) => { setTekst(t); if (status === 'feil') setStatus('klar'); }}
        maxLength={MAKS_TEGN}
        placeholder="Skriv en tanke, et spørsmål eller et bønneemne"
        placeholderTextColor={farge.dempet}
        textAlignVertical="top"
        accessibilityLabel="Ditt svar til presten"
        accessibilityLabelledBy="svarEtikett"
        accessibilityHint="Svaret sendes uten navn"
        editable={status !== 'sender'}
      />
      <Text style={stil.hjelp} accessibilityLiveRegion={igjen < 100 ? 'polite' : 'none'}>
        {igjen < 200 ? `${igjen} tegn igjen` : 'Svaret sendes uten navn. Presten i menigheten kan lese det, og administrator har teknisk tilgang.'}
      </Text>

      {status === 'feil' ? <Melding type="feil">{feilmelding}</Melding> : null}

      <Knapp
        tittel={status === 'sender' ? 'Sender …' : 'Send til presten'}
        onPress={send}
        opptatt={status === 'sender'}
        hint="Sender svaret ditt uten navn"
      />
    </View>
  );
}

export default function App() {
  const [gudstjeneste, setGudstjeneste] = useState(null);
  const [status, setStatus] = useState('laster'); // laster | klar | tom | feil
  const [oppdaterer, setOppdaterer] = useState(false);

  const hent = useCallback(async () => {
    try {
      const { data: rad, error } = await data.hentNeste(MENIGHET_ID);
      if (error) throw error;
      setGudstjeneste(rad);
      setStatus(rad ? 'klar' : 'tom');
    } catch (err) {
      console.log('[KirkePulsen] Kunne ikke hente gudstjeneste:', err?.code, err?.message);
      setStatus('feil');
    }
  }, []);

  useEffect(() => { hent(); }, [hent]);

  async function dra() {
    setOppdaterer(true);
    await hent();
    setOppdaterer(false);
  }

  return (
    <SafeAreaView style={stil.side}>
      <KeyboardAvoidingView style={stil.side} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={stil.innhold}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={oppdaterer} onRefresh={dra} tintColor={farge.gronn} />}
        >
          <View style={stil.topp}>
            <Text style={stil.merke} accessibilityRole="header">KirkePulsen</Text>
            <Text style={stil.underTittel}>
              {gudstjeneste?.menighet?.navn ?? 'Fra menigheten til presten'}
            </Text>
          </View>

          {status === 'laster' ? (
            <View style={stil.sentrert} accessibilityLabel="Henter neste gudstjeneste" accessible>
              <ActivityIndicator size="large" color={farge.gronn} />
              <Text style={stil.hjelp}>Henter neste gudstjeneste …</Text>
            </View>
          ) : null}

          {status === 'feil' ? (
            <View style={stil.kort}>
              <Melding type="feil">Fikk ikke hentet gudstjenesten. Sjekk nettforbindelsen.</Melding>
              <Knapp tittel="Prøv igjen" onPress={() => { setStatus('laster'); hent(); }} />
            </View>
          ) : null}

          {status === 'tom' ? (
            <View style={stil.kort}>
              <Text style={stil.tittel} accessibilityRole="header">Ingen kommende gudstjeneste ennå</Text>
              <Text style={stil.brodtekst}>
                Når presten publiserer neste gudstjeneste, kan du svare på spørsmålet her. Dra ned for å sjekke på nytt.
              </Text>
            </View>
          ) : null}

          {status === 'klar' && gudstjeneste ? (
            <View style={stil.kort}>
              <Text style={stil.dato}>{lesbarDato(gudstjeneste.dato_tid)}</Text>
              <Text style={stil.tittel} accessibilityRole="header">{gudstjeneste.tittel}</Text>
              {gudstjeneste.beskrivelse ? <Text style={stil.brodtekst}>{gudstjeneste.beskrivelse}</Text> : null}

              {gudstjeneste.sporsmal_fra_prest ? (
                <View style={stil.sporsmal} accessible accessibilityLabel={`Prestens spørsmål: ${gudstjeneste.sporsmal_fra_prest}`}>
                  <Text style={stil.sporsmalEtikett}>Prestens spørsmål</Text>
                  <Text style={stil.sporsmalTekst}>{gudstjeneste.sporsmal_fra_prest}</Text>
                </View>
              ) : null}

              {gudstjeneste.svarfrist && new Date(gudstjeneste.svarfrist) > new Date() ? (
                <Text style={stil.hjelp}>Du kan svare til {lesbarDato(gudstjeneste.svarfrist)}.</Text>
              ) : null}

              <SvarSkjema key={gudstjeneste.id} gudstjeneste={gudstjeneste} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// 5. Stiler
// Ingen faste høyder på tekst – alt vokser med skriftstørrelsen på enheten.
// -----------------------------------------------------------------------------

const stil = StyleSheet.create({
  side: { flex: 1, backgroundColor: farge.kalk },
  innhold: { padding: 20, paddingBottom: 48, maxWidth: 640, width: '100%', alignSelf: 'center' },

  topp: { marginBottom: 24, paddingTop: 8 },
  merke: { fontSize: 20, fontWeight: '700', color: farge.blekk },
  underTittel: { fontSize: 16, color: farge.dempet, marginTop: 2 },

  sentrert: { alignItems: 'center', paddingVertical: 48, gap: 12 },

  kort: {
    backgroundColor: farge.flate,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#DDE3E0',
  },
  dato: { fontSize: 15, color: farge.dempet, marginBottom: 4 },
  tittel: {
    fontSize: 24, lineHeight: 30, fontWeight: '600', color: farge.blekk, marginBottom: 8,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
  },
  brodtekst: { fontSize: 17, lineHeight: 26, color: farge.blekk, marginBottom: 12 },

  sporsmal: {
    marginTop: 8, marginBottom: 16,
    paddingVertical: 14, paddingLeft: 16, paddingRight: 12,
    borderLeftWidth: 3, borderLeftColor: farge.gronn,
    backgroundColor: farge.gronnLys, borderRadius: 6,
  },
  sporsmalEtikett: { fontSize: 15, fontWeight: '700', color: farge.gronn, marginBottom: 6 },
  sporsmalTekst: {
    fontSize: 19, lineHeight: 29, color: farge.blekk,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
  },

  skjema: { marginTop: 16, gap: 10 },
  feltTittel: { fontSize: 17, fontWeight: '700', color: farge.blekk },
  tekstfelt: {
    minHeight: 120,
    backgroundColor: farge.flate,
    borderWidth: 1.5, borderColor: farge.kant, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 17, lineHeight: 24, color: farge.blekk,
  },
  tekstfeltFeil: { borderColor: farge.feil },
  hjelp: { fontSize: 15, lineHeight: 21, color: farge.dempet },

  knapp: {
    minHeight: 52,
    backgroundColor: farge.gronn, borderRadius: 8,
    paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  knappTrykket: { backgroundColor: '#234638' },
  knappAv: { opacity: 0.75 },
  knappSpinner: { marginRight: 10 },
  knappTekst: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },

  melding: { borderLeftWidth: 4, borderRadius: 6, padding: 14, marginVertical: 4 },
  meldingFeil: { backgroundColor: farge.feilLys, borderLeftColor: farge.feil },
  meldingOk: { backgroundColor: farge.okLys, borderLeftColor: farge.ok },
  meldingTekst: { fontSize: 16, lineHeight: 23 },

  takk: { marginTop: 16, gap: 8 },
  lenkeKnapp: { minHeight: 48, justifyContent: 'center' },
  lenkeTekst: { fontSize: 17, color: farge.gronn, textDecorationLine: 'underline', fontWeight: '600' },
});
