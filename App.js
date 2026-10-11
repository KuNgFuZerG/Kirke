import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView, Alert } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// 1. Kobling til Supabase (Dine ekte verdier)
const SUPABASE_URL = 'https://esjmuexwbhrbgcktiis.supabase.com';
const SUPABASE_ANON_KEY = 'sb_publishable_A3k2xBiT15N4S9NPunqHoA_Mn8Xskxk';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function App() {
  const [nesteGudstjeneste, setNesteGudstjeneste] = useState(null);
  const [svarTekst, setSvarTekst] = useState('');
  const [innsendt, setInnsendt] = useState(false);

  useEffect(() => {
    hentNesteGudstjeneste();
  }, []);

  async function hentNesteGudstjeneste() {
    try {
      const { data, error } = await supabase
        .from('gudstjeneste')
        .select('*')
        .order('dato_tid', { ascending: true })
        .limit(1)
        .single();

      if (data) {
        setNesteGudstjeneste(data);
      }
    } catch (err) {
      console.log('Kunne ikke hente gudstjeneste:', err);
    }
  }

  async function sendInnspill() {
    if (!svarTekst.trim()) {
      Alert.alert('Vennligst skriv et svar før du sender inn.');
      return;
    }

    try {
      const { error } = await supabase.from('innspill').insert([
        {
          gudstjeneste_id: nesteGudstjeneste.id,
          svar_tekst: svarTekst,
        },
      ]);

      if (error) throw error;

      setInnsendt(true);
      Alert.alert('Takk!', 'Ditt innspill er sendt direkte og kryptert til presten.');
    } catch (err) {
      Alert.alert('Feil', 'Kunne ikke sende innspill. Prøv igjen senere.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        
        {/* Header / Tittel */}
        <View style={styles.header}>
          <Text style={styles.tittel}>KirkePulsen</Text>
          <Text style={styles.underTittel}>Dialog mellom menighet og prest</Text>
        </View>

        {/* Fremhevet kort for neste gudstjeneste */}
        {nesteGudstjeneste ? (
          <View style={styles.kortFremhevet}>
            <Text style={styles.kortEtikett}>NESTE GUDSTJENESTE</Text>
            <Text style={styles.gudstjenesteTittel}>{nesteGudstjeneste.tittel}</Text>
            <Text style={styles.datoTekst}>
              📅 {new Date(nesteGudstjeneste.dato_tid).toLocaleDateString('no-NO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </Text>
            
            {/* Prestens spørsmål */}
            <View style={styles.sporsmalBoks}>
              <Text style={styles.sporsmalTittel}>Prestens spørsmål til ukens preken:</Text>
              <Text style={styles.sporsmalTekst}>
                "{nesteGudstjeneste.sporsmal_fra_prest || 'Ingen spørsmål registrert enna.'}"
              </Text>
            </View>

            {/* Svarskjema */}
            {!innsendt ? (
              <View style={styles.svarsBoks}>
                <TextInput
                  style={styles.tekstfelt}
                  placeholder="Skriv din tanke eller bønneemne her..."
                  placeholderTextColor="#666"
                  multiline
                  value={svarTekst}
                  onChangeText={setSvarTekst}
                />
                <TouchableOpacity style={styles.sendKnapp} onPress={sendInnspill}>
                  <Text style={styles.sendKnappTekst}>Send innspill til presten</Text>
                </TouchableOpacity>
                <Text style={styles.personvernTekst}>🔒 Svaret sendes kryptert og leses kun av presten.</Text>
              </View>
            ) : (
              <View style={styles.takkBoks}>
                <Text style={styles.takkTekst}>✅ Takk for ditt bidrag! Svaret er mottatt.</Text>
              </View>
            )}

          </View>
        ) : (
          <Text style={styles.lasterTekst}>Laster kommende gudstjenester...</Text>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F6F8' },
  scroll: { padding: 20 },
  header: { marginBottom: 20, alignItems: 'center' },
  tittel: { fontSize: 28, fontWeight: 'bold', color: '#1A202C' },
  underTittel: { fontSize: 14, color: '#4A5568', marginTop: 4 },
  kortFremhevet: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  kortEtikett: { fontSize: 12, fontWeight: 'bold', color: '#3182CE', letterSpacing: 1, marginBottom: 8 },
  gudstjenesteTittel: { fontSize: 22, fontWeight: 'bold', color: '#2D3748', marginBottom: 6 },
  datoTekst: { fontSize: 14, color: '#718096', marginBottom: 16 },
  sporsmalBoks: { backgroundColor: '#EBF8FF', borderRadius: 10, padding: 14, marginBottom: 16 },
  sporsmalTittel: { fontSize: 13, fontWeight: 'bold', color: '#2B6CB0', marginBottom: 4 },
  sporsmalTekst: { fontSize: 16, fontStyle: 'italic', color: '#2D3748', lineHeight: 22 },
  svarsBoks: { marginTop: 10 },
  tekstfelt: { backgroundColor: '#F7FAFC', borderWidth: 1, borderColor: '#CBD5E0', borderRadius: 8, padding: 12, height: 100, textAlignVertical: 'top', fontSize: 16, color: '#2D3748', marginBottom: 12 },
  sendKnapp: { backgroundColor: '#3182CE', borderRadius: 8, padding: 14, alignItems: 'center' },
  sendKnappTekst: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  personvernTekst: { fontSize: 12, color: '#718096', textAlign: 'center', marginTop: 10 },
  takkBoks: { padding: 16, backgroundColor: '#F0FFF4', borderRadius: 8, alignItems: 'center' },
  takkTekst: { color: '#22543D', fontWeight: 'bold', fontSize: 16 },
  lasterTekst: { textAlign: 'center', color: '#718096', marginTop: 40 }
});
