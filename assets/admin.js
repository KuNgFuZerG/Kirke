/**
 * KirkePulsen – prestens side.
 *
 * Inndeling:
 *   1. Oppsett og tilstand
 *   2. Hjelpefunksjoner (dato, DOM, meldinger, logging)
 *   3. Data – alle kall mot Supabase samlet ett sted (enkelt å flytte til Broen)
 *   4. Visning – tegner lister og skjema
 *   5. Hendelser – innlogging, lagring, sletting, menighetsbytte
 *
 * Tilgang styres av databasen: bare brukere i tabellen `prest` får lese innspill og
 * endre gudstjenester, og bare for sine egne menigheter. Koden her er bare grensesnittet.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Oppsett og tilstand
  // ---------------------------------------------------------------------------

  const CFG = window.KIRKEPULSEN_CONFIG;
  const LOGG = '[KirkePulsen]';
  const VALGT_NOKKEL = 'kirkepulsen.valgtMenighet';

  const tilstand = {
    roller: [],        // [{ menighet_id, menighet: { navn, kommune } }]
    menighet: null,    // valgt rolle
    gudstjenester: [], // kommende gudstjenester i valgt menighet
  };

  const $ = (id) => document.getElementById(id);

  let db = null;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    db = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
  } else {
    console.error(`${LOGG} Supabase-biblioteket ble ikke lastet.`);
  }

  // ---------------------------------------------------------------------------
  // 2. Hjelpefunksjoner
  // ---------------------------------------------------------------------------

  const datoFormat = new Intl.DateTimeFormat('nb-NO', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
  const kortDato = new Intl.DateTimeFormat('nb-NO', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  /** "søndag 18. oktober kl. 11:00" */
  function lesbarDato(d) {
    const s = datoFormat.format(new Date(d));
    return s.replace(/ (\d{2}:\d{2})$/, ' kl. $1').replace(' kl. kl.', ' kl.');
  }

  /** Date → verdi for <input type="datetime-local"> i lokal tid. */
  function tilInputVerdi(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Neste søndag etter i dag, kl. 11:00. Er det søndag i dag, blir det neste uke. */
  function nesteSondag() {
    const d = new Date();
    const dagerTil = (7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + dagerTil);
    d.setHours(CFG.standardKlokkeslett.time, CFG.standardKlokkeslett.minutt, 0, 0);
    return d;
  }

  /**
   * Svarfrist: normalt 24 timer før gudstjenesten. Er det mindre enn 24 timer igjen,
   * kan menigheten svare helt til gudstjenesten starter. Fristen havner aldri i fortiden.
   */
  function beregnSvarfrist(dato) {
    const vanlig = new Date(dato.getTime() - CFG.svarfristTimerFor * 3600 * 1000);
    return vanlig > new Date() ? vanlig : dato;
  }

  function visMelding(tekst, type = 'ok') {
    const el = $('melding');
    el.className = `melding melding-${type}`;
    el.setAttribute('role', type === 'feil' ? 'alert' : 'status');
    el.textContent = tekst;
    el.hidden = false;
  }
  function skjulMelding() { $('melding').hidden = true; }

  function loggFeil(sted, error) {
    console.group(`${LOGG} Feil: ${sted}`);
    console.error('Melding:', error?.message);
    if (error?.code) console.error('Kode:', error.code, '(42501 = nektet av tilgangsreglene, 23503 = andre data peker hit)');
    if (error?.details) console.error('Detaljer:', error.details);
    if (error?.hint) console.error('Hint:', error.hint);
    console.groupEnd();
  }

  /** Forklarer en databasefeil i et språk presten forstår. */
  function forklarFeil(error) {
    if (!error) return 'Noe gikk galt.';
    if (error.code === '42501') return 'Du har ikke tilgang til dette i denne menigheten.';
    if (error.code === '23503') return 'Gudstjenesten har innspill og kan ikke slettes.';
    if (/Failed to fetch|NetworkError/i.test(error.message)) return 'Fikk ikke kontakt med serveren. Sjekk nettforbindelsen og prøv igjen.';
    return error.message;
  }

  /** Lager et element: el('p', { class: 'x' }, 'tekst', barn …). Tekst settes alltid som tekst, aldri som HTML. */
  function el(tag, attrs = {}, ...barn) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const b of barn.flat()) if (b != null && b !== false) node.append(b);
    return node;
  }

  function settOpptatt(knapp, opptatt, tekstNarOpptatt) {
    if (opptatt) {
      knapp.dataset.tekst = knapp.textContent;
      knapp.disabled = true;
      knapp.setAttribute('aria-busy', 'true');
      knapp.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), tekstNarOpptatt);
    } else {
      knapp.disabled = false;
      knapp.removeAttribute('aria-busy');
      if (knapp.dataset.tekst) knapp.textContent = knapp.dataset.tekst;
    }
  }

  function visSkjelett(container, linjer = 2) {
    container.setAttribute('aria-busy', 'true');
    container.replaceChildren(...Array.from({ length: linjer }, (_, i) =>
      el('span', { class: `skjelett ${i === linjer - 1 ? 'kort' : 'lang'}` })));
  }

  // ---------------------------------------------------------------------------
  // 3. Data
  // ---------------------------------------------------------------------------

  const data = {
    async hentRoller(brukerId) {
      return db.from('prest')
        .select('menighet_id, menighet(navn, kommune)')
        .eq('user_id', brukerId);
    },

    /** Kommende gudstjenester (inkludert dem som startet de siste 3 timene). */
    async hentKommende(menighetId) {
      const fra = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      return db.from('gudstjeneste')
        .select('id, tittel, beskrivelse, sporsmal_fra_prest, dato_tid, svarfrist')
        .eq('menighet_id', menighetId)
        .gte('dato_tid', fra)
        .order('dato_tid', { ascending: true });
    },

    async hentInnspill(menighetId) {
      return db.from('innspill')
        .select(`id, svar_tekst, sendt_tidspunkt, krise, arkivert_at, kan_svare:svar_nokkel_hash, slettes:innspill_slettes,
                 gudstjeneste!inner(id, tittel, dato_tid, menighet_id),
                 prest_svar(id, tekst, sendt_tidspunkt)`)
        .eq('gudstjeneste.menighet_id', menighetId)
        .order('sendt_tidspunkt', { ascending: false });
    },

    /** Arkiverer (true) eller henter innspillet ut av arkivet (false). */
    async arkiver(id, arkiver) {
      return db.from('innspill').update({ arkivert_at: arkiver ? new Date().toISOString() : null }).eq('id', id).select('id');
    },

    /** Svar til avsenderen. Vises bare i appen på telefonen som sendte innspillet. */
    async sendSvar(innspillId, tekst) {
      return db.from('prest_svar').insert([{ innspill_id: innspillId, tekst }]).select('id');
    },

    async opprett(rad) {
      return db.from('gudstjeneste').insert([rad]);
    },

    async oppdater(id, rad) {
      return db.from('gudstjeneste').update(rad).eq('id', id).select('id');
    },

    async slett(id) {
      return db.from('gudstjeneste').delete().eq('id', id).select('id');
    },

    /** Fjerner et innspill for godt. Tilgangsreglene tillater det bare for prester i riktig menighet. */
    async fjernInnspill(id) {
      return db.from('innspill').delete().eq('id', id).select('id');
    },
  };

  // ---------------------------------------------------------------------------
  // 4. Visning
  // ---------------------------------------------------------------------------

  function visSkjerm(navn) {
    $('laster').hidden = navn !== 'laster';
    $('innlogging').hidden = navn !== 'innlogging';
    $('dashbord').hidden = navn !== 'dashbord';
    $('loggUtKnapp').hidden = navn === 'innlogging' || navn === 'laster';
  }

  function oppdaterFristForklaring() {
    const verdi = $('dato').value;
    if (!verdi) { $('fristForklaring').textContent = ''; return; }
    const dato = new Date(verdi);
    const frist = beregnSvarfrist(dato);
    $('fristForklaring').textContent = frist.getTime() === dato.getTime()
      ? `Menigheten kan svare helt til gudstjenesten starter.`
      : `Menigheten kan svare til ${lesbarDato(frist)}.`;
  }

  function nullstillSkjema() {
    $('redigerId').value = '';
    $('tittel').value = 'Søndagsgudstjeneste';
    $('beskrivelse').value = '';
    $('sporsmal').value = '';
    $('dato').value = tilInputVerdi(nesteSondag());
    $('skjemaTittel').textContent = 'Ny gudstjeneste';
    $('lagreKnapp').textContent = 'Publiser';
    $('avbrytKnapp').hidden = true;
    for (const id of ['tittel', 'dato']) settFeltFeil(id, '');
    oppdaterFristForklaring();
  }

  function settFeltFeil(id, tekst) {
    const felt = $(id), feil = $(`${id}Feil`);
    if (tekst) {
      felt.setAttribute('aria-invalid', 'true');
      feil.textContent = tekst;
      feil.hidden = false;
    } else {
      felt.removeAttribute('aria-invalid');
      feil.hidden = true;
    }
  }

  function startRedigering(g) {
    $('redigerId').value = g.id;
    $('tittel').value = g.tittel || '';
    $('beskrivelse').value = g.beskrivelse || '';
    $('sporsmal').value = g.sporsmal_fra_prest || '';
    $('dato').value = tilInputVerdi(new Date(g.dato_tid));
    $('skjemaTittel').textContent = 'Endre gudstjeneste';
    $('lagreKnapp').textContent = 'Lagre endringer';
    $('avbrytKnapp').hidden = false;
    oppdaterFristForklaring();
    $('skjemaTittel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('tittel').focus({ preventScroll: true });
  }

  function tegnGudstjenester() {
    const liste = $('gudstjenesteListe');
    liste.removeAttribute('aria-busy');

    if (tilstand.gudstjenester.length === 0) {
      liste.replaceChildren(el('p', { class: 'tomt' }, 'Ingen kommende gudstjenester. Bruk skjemaet over for å publisere den neste.'));
      return;
    }

    liste.replaceChildren(el('ul', { class: 'gudstjenester' },
      tilstand.gudstjenester.map((g) => {
        const rad = el('li', { class: 'gudstjeneste' },
          el('p', { class: 'gudstjeneste-dato' }, lesbarDato(g.dato_tid)),
          el('h3', { class: 'gudstjeneste-tittel' }, g.tittel),
          g.beskrivelse ? el('p', { class: 'gudstjeneste-tema' }, g.beskrivelse) : null,
          g.sporsmal_fra_prest ? null : el('p', { class: 'gudstjeneste-mangler' }, 'Mangler spørsmål til menigheten.'),
        );
        // Skjermlesertekst må skille gudstjenester med samme tittel og tid, så temaet tas med.
        const beskrivende = [g.tittel, lesbarDato(g.dato_tid), g.beskrivelse || 'uten tema'].join(', ');
        const handlinger = el('div', { class: 'knapperad' },
          el('button', { type: 'button', class: 'knapp-lenke', onclick: () => startRedigering(g),
            'aria-label': `Endre ${beskrivende}` }, 'Endre'),
          el('button', { type: 'button', class: 'knapp-lenke fare', onclick: () => visSlettBekreftelse(rad, g),
            'aria-label': `Slett ${beskrivende}` }, 'Slett'),
        );
        rad.append(handlinger);
        return rad;
      }),
    ));
  }

  /** Bekreftelse inne i listen i stedet for et nettleservindu, så den kan brukes med tastatur og skjermleser. */
  function visSlettBekreftelse(rad, g) {
    rad.querySelector('.bekreft-slett')?.remove();
    const jaKnapp = el('button', { type: 'button', class: 'knapp knapp-fare' }, 'Slett gudstjenesten');
    const neiKnapp = el('button', { type: 'button', class: 'knapp knapp-rolig' }, 'Behold');
    const boks = el('div', { class: 'bekreft-slett', role: 'group', 'aria-label': 'Bekreft sletting' },
      el('p', {}, `Slette «${g.tittel}» ${lesbarDato(g.dato_tid)}? Dette kan ikke angres.`),
      el('div', { class: 'knapperad' }, jaKnapp, neiKnapp),
    );
    neiKnapp.addEventListener('click', () => { boks.remove(); rad.querySelector('.fare')?.focus(); });
    jaKnapp.addEventListener('click', () => slettGudstjeneste(g, jaKnapp));
    rad.append(boks);
    neiKnapp.focus();
  }

  async function arkiverInnspill(innspill, arkiver, knapp) {
    settOpptatt(knapp, true, arkiver ? 'Arkiverer …' : 'Flytter …');
    const { data: ok, error } = await data.arkiver(innspill.id, arkiver);
    if (error || !ok?.length) {
      loggFeil('arkivering av innspill', error);
      settOpptatt(knapp, false);
      visMelding(`Innspillet ble ikke ${arkiver ? 'arkivert' : 'flyttet'}: ${forklarFeil(error || { message: 'Fant ikke innspillet.' })}`, 'feil');
      return;
    }
    visMelding(arkiver ? 'Innspillet er arkivert.' : 'Innspillet er flyttet ut av arkivet.', 'ok');
    await lastMenighet();
  }

  async function sendSvar(innspill, tekstfelt, knapp) {
    const tekst = tekstfelt.value.trim();
    if (!tekst) { visMelding('Skriv et svar før du sender.', 'feil'); tekstfelt.focus(); return; }
    if (tekst.includes('[ditt telefonnummer]')) {
      visMelding('Bytt ut «[ditt telefonnummer]» med nummeret ditt, eller fjern setningen.', 'feil');
      tekstfelt.focus(); return;
    }
    settOpptatt(knapp, true, 'Sender …');
    const { data: ok, error } = await data.sendSvar(innspill.id, tekst);
    if (error || !ok?.length) {
      loggFeil('svar til avsender', error);
      settOpptatt(knapp, false);
      visMelding(`Svaret ble ikke sendt: ${forklarFeil(error || { message: 'Ukjent feil.' })}`, 'feil');
      return;
    }
    visMelding('Svaret er sendt. Avsenderen ser det neste gang appen åpnes på telefonen som sendte innspillet.', 'ok');
    await lastMenighet();
  }

  /** Samme mønster som for gudstjenester: bekreftelse inne i listen, ingen nettleservindu. */
  function visFjernBekreftelse(rad, innspill) {
    rad.querySelector('.bekreft-slett')?.remove();
    const jaKnapp = el('button', { type: 'button', class: 'knapp knapp-fare' }, 'Fjern innspillet');
    const neiKnapp = el('button', { type: 'button', class: 'knapp knapp-rolig' }, 'Behold');
    const boks = el('div', { class: 'bekreft-slett', role: 'group', 'aria-label': 'Bekreft fjerning' },
      el('p', {}, 'Fjerne dette innspillet for godt? Det kan ikke hentes tilbake.'),
      el('div', { class: 'knapperad' }, jaKnapp, neiKnapp),
    );
    neiKnapp.addEventListener('click', () => { boks.remove(); rad.querySelector('.fare')?.focus(); });
    jaKnapp.addEventListener('click', () => fjernInnspill(innspill, jaKnapp));
    rad.append(boks);
    neiKnapp.focus();
  }

  async function fjernInnspill(innspill, knapp) {
    settOpptatt(knapp, true, 'Fjerner …');
    const { data: fjernet, error } = await data.fjernInnspill(innspill.id);
    if (error || !fjernet?.length) {
      loggFeil('fjerning av innspill', error);
      settOpptatt(knapp, false);
      visMelding(`Innspillet ble ikke fjernet: ${forklarFeil(error || { message: 'Fant ikke innspillet.' })}`, 'feil');
      return;
    }
    visMelding('Innspillet er fjernet.', 'ok');
    await lastMenighet();
    $('innspillTittel').focus?.();
  }

  /** Forslag presten kan tilpasse når et innspill tyder på krise. */
  const KRISEMAL = 'Takk for at du delte dette med meg. Det du skriver, høres tungt ut, og jeg vil gjerne snakke med deg. ' +
    'Du kan nå meg på [ditt telefonnummer], eller ta kontakt etter gudstjenesten.\n\n' +
    'Hvis det haster, kan du ringe Kirkens SOS på 22 40 00 40 eller Mental Helse på 116 123. Begge er døgnåpne. ' +
    'Er livet i fare, ring 113.';

  const datoKort = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });

  /** «Slettes automatisk 18. januar 2027», tydelig når det er under 30 dager igjen. */
  function sletteLinje(i) {
    if (!i.slettes) return null;
    const dager = Math.ceil((new Date(i.slettes) - Date.now()) / 86400000);
    const dato = datoKort.format(new Date(i.slettes));
    if (dager <= 30) {
      return el('p', { class: 'slettes snart' },
        dager <= 0 ? `Slettes i natt (${dato}).` : `Slettes om ${dager} ${dager === 1 ? 'dag' : 'dager'} (${dato}). Last ned nå hvis du trenger det videre.`);
    }
    return el('p', { class: 'slettes' }, `Slettes automatisk ${dato}.`);
  }

  /** Lager en tekstfil med innspillet og prestens svar, og laster den ned. */
  function lastNedInnspill(i) {
    const linjer = [
      'KirkePulsen – innspill',
      `Menighet: ${tilstand.menighet?.menighet?.navn ?? ''}`,
      `Gudstjeneste: ${i.gudstjeneste.tittel}, ${lesbarDato(i.gudstjeneste.dato_tid)}`,
      `Sendt: ${kortDato.format(new Date(i.sendt_tidspunkt))}`,
      i.krise ? 'Merket: kan trenge oppfølging' : null,
      '',
      'Innspill:',
      i.svar_tekst,
      ...[...(i.prest_svar || [])]
        .sort((a, b) => new Date(a.sendt_tidspunkt) - new Date(b.sendt_tidspunkt))
        .flatMap((s) => ['', `Ditt svar (${kortDato.format(new Date(s.sendt_tidspunkt))}):`, s.tekst]),
      '',
      '—',
      'Lastet ned ' + kortDato.format(new Date()) + '. Denne kopien slettes ikke automatisk.',
      'Oppbevares bare på jobbenhet, etter arbeidsgiverens rutiner for taushetsbelagte opplysninger.',
    ].filter((l) => l !== null);

    const blob = new Blob([linjer.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `innspill-${new Date(i.sendt_tidspunkt).toISOString().slice(0, 10)}.txt` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function visNedlastingAdvarsel(rad, innspill) {
    rad.querySelector('.bekreft-slett')?.remove();
    const jaKnapp = el('button', { type: 'button', class: 'knapp' }, 'Last ned');
    const neiKnapp = el('button', { type: 'button', class: 'knapp knapp-rolig' }, 'Avbryt');
    const boks = el('div', { class: 'bekreft-slett nedlasting', role: 'group', 'aria-label': 'Bekreft nedlasting' },
      el('p', {}, 'Lagre bare på en jobbenhet, etter arbeidsgiverens rutiner. Den nedlastede kopien slettes ikke automatisk, så du er selv ansvarlig for den.'),
      el('div', { class: 'knapperad' }, jaKnapp, neiKnapp),
    );
    neiKnapp.addEventListener('click', () => { boks.remove(); rad.querySelector('.knapp-lenke')?.focus(); });
    jaKnapp.addEventListener('click', () => {
      lastNedInnspill(innspill);
      boks.remove();
      visMelding('Innspillet er lastet ned som tekstfil.', 'ok');
    });
    rad.append(boks);
    neiKnapp.focus();
  }

  /** Ett innspill med tekst, eventuelle svar og handlingsknapper. */
  function tegnEttInnspill(i, visGudstjeneste) {
    const tid = kortDato.format(new Date(i.sendt_tidspunkt));
    const rad = el('li', { class: `innspill${i.krise ? ' innspill-krise' : ''}` },
      i.krise ? el('p', { class: 'krise-merke' }, 'Kan trenge oppfølging') : null,
      el('blockquote', {}, i.svar_tekst),
      el('p', { class: 'innspill-tid' },
        visGudstjeneste ? `Sendt ${tid} til ${i.gudstjeneste.tittel}, ${lesbarDato(i.gudstjeneste.dato_tid)}` : `Sendt ${tid}`),
      sletteLinje(i),
    );

    const svar = [...(i.prest_svar || [])].sort((a, b) => new Date(a.sendt_tidspunkt) - new Date(b.sendt_tidspunkt));
    if (svar.length) {
      rad.append(el('div', { class: 'prest-svar' },
        el('p', { class: 'felt-tittel' }, svar.length === 1 ? 'Ditt svar' : 'Dine svar'),
        svar.map((s) => el('div', { class: 'prest-svar-tekst' },
          el('p', {}, s.tekst),
          el('p', { class: 'innspill-tid' }, `Sendt ${kortDato.format(new Date(s.sendt_tidspunkt))}`),
        )),
      ));
    }

    const knapper = el('div', { class: 'knapperad' });
    if (i.kan_svare) {
      knapper.append(el('button', { type: 'button', class: 'knapp-lenke', onclick: () => visSvarSkjema(rad, i),
        'aria-label': `Svar avsenderen av innspill sendt ${tid}` }, 'Svar avsenderen'));
    }
    knapper.append(el('button', { type: 'button', class: 'knapp-lenke', onclick: (e) => arkiverInnspill(i, !i.arkivert_at, e.currentTarget),
      'aria-label': `${i.arkivert_at ? 'Flytt ut av arkivet' : 'Arkiver'} innspill sendt ${tid}` },
      i.arkivert_at ? 'Flytt ut av arkivet' : 'Arkiver'));
    knapper.append(el('button', { type: 'button', class: 'knapp-lenke', onclick: () => visNedlastingAdvarsel(rad, i),
      'aria-label': `Last ned innspill sendt ${tid}` }, 'Last ned'));
    knapper.append(el('button', { type: 'button', class: 'knapp-lenke fare', onclick: () => visFjernBekreftelse(rad, i),
      'aria-label': `Fjern innspill sendt ${tid}` }, 'Fjern'));
    rad.append(knapper);
    return rad;
  }

  function visSvarSkjema(rad, innspill) {
    if (rad.querySelector('.svar-skjema')) { rad.querySelector('.svar-skjema textarea').focus(); return; }
    const id = `svar-${innspill.id}`;
    const tekstfelt = el('textarea', { id, maxlength: '2000', 'aria-describedby': `${id}-hjelp` });
    const sendKnapp = el('button', { type: 'submit', class: 'knapp' }, 'Send svar');
    const avbryt = el('button', { type: 'button', class: 'knapp knapp-rolig' }, 'Avbryt');
    const skjema = el('form', { class: 'svar-skjema skjema', novalidate: true },
      el('div', { class: 'felt' },
        el('label', { for: id }, 'Svar til avsenderen'),
        tekstfelt,
        el('p', { class: 'hjelp', id: `${id}-hjelp` },
          'Avsenderen ser svaret bare i appen på telefonen som sendte innspillet, neste gang appen åpnes. Ikke regn med at det leses raskt.'),
      ),
      el('div', { class: 'knapperad' },
        innspill.krise ? el('button', { type: 'button', class: 'knapp knapp-rolig', onclick: () => {
          tekstfelt.value = KRISEMAL; tekstfelt.focus();
          const pos = KRISEMAL.indexOf('[ditt telefonnummer]');
          tekstfelt.setSelectionRange(pos, pos + '[ditt telefonnummer]'.length);
        } }, 'Bruk forslag til krisesvar') : null,
        sendKnapp, avbryt),
    );
    avbryt.addEventListener('click', () => { skjema.remove(); rad.querySelector('.knapp-lenke')?.focus(); });
    skjema.addEventListener('submit', (e) => { e.preventDefault(); sendSvar(innspill, tekstfelt, sendKnapp); });
    rad.querySelector('.knapperad').before(skjema);
    tekstfelt.focus();
  }

  function tegnInnspill(rader) {
    const liste = $('innspillListe');
    liste.removeAttribute('aria-busy');

    if (rader.length === 0) {
      liste.replaceChildren(el('p', { class: 'tomt' }, 'Ingen innspill ennå. De dukker opp her når menigheten svarer.'));
      return;
    }

    const krise = rader.filter((r) => r.krise && !r.arkivert_at);
    const vanlige = rader.filter((r) => !r.krise && !r.arkivert_at);
    const arkiv = rader.filter((r) => r.arkivert_at);
    const deler = [];

    // Innspill som kan tyde på krise, øverst og tydelig merket.
    if (krise.length) {
      deler.push(el('section', { class: 'innspill-gruppe krise-gruppe', 'aria-labelledby': 'kriseTittel' },
        el('h3', { id: 'kriseTittel' }, `Trenger kanskje oppfølging (${krise.length})`),
        el('p', { class: 'hjelp' }, 'Disse innspillene inneholder ord som kan tyde på at noen har det svært vanskelig. Når slike ord skrives, viser appen avsenderen nummer til Kirkens SOS, Mental Helse og 113 med en gang.'),
        el('ul', { class: 'innspill-liste' }, krise.map((i) => tegnEttInnspill(i, true))),
      ));
    }

    // Vanlige innspill, gruppert per gudstjeneste, nyeste gudstjeneste først.
    const grupper = new Map();
    for (const r of vanlige) {
      const g = r.gudstjeneste;
      if (!grupper.has(g.id)) grupper.set(g.id, { g, innspill: [] });
      grupper.get(g.id).innspill.push(r);
    }
    [...grupper.values()].sort((a, b) => new Date(b.g.dato_tid) - new Date(a.g.dato_tid)).forEach(({ g, innspill }) => {
      deler.push(el('section', { class: 'innspill-gruppe', 'aria-label': `Innspill til ${g.tittel}` },
        el('h3', {}, g.tittel),
        el('p', { class: 'gudstjeneste-dato' }, `${lesbarDato(g.dato_tid)} (${innspill.length} innspill)`),
        el('ul', { class: 'innspill-liste' }, innspill.map((i) => tegnEttInnspill(i, false))),
      ));
    });

    if (!krise.length && !vanlige.length) {
      deler.push(el('p', { class: 'tomt' }, 'Ingen nye innspill. Arkiverte innspill ligger nedenfor.'));
    }

    // Arkiv, sammenslått som standard.
    if (arkiv.length) {
      deler.push(el('details', { class: 'arkiv' },
        el('summary', {}, `Arkiv (${arkiv.length})`),
        el('ul', { class: 'innspill-liste' }, arkiv.map((i) => tegnEttInnspill(i, true))),
      ));
    }

    liste.replaceChildren(...deler);
  }

  // ---------------------------------------------------------------------------
  // 5. Hendelser
  // ---------------------------------------------------------------------------

  async function lastMenighet() {
    visSkjelett($('gudstjenesteListe'), 2);
    visSkjelett($('innspillListe'), 3);
    const id = tilstand.menighet.menighet_id;

    const [kommende, innspill] = await Promise.all([data.hentKommende(id), data.hentInnspill(id)]);

    // Har presten byttet menighet mens svarene var underveis? Da gjelder de ikke lenger.
    if (tilstand.menighet?.menighet_id !== id) return;

    if (kommende.error) {
      loggFeil('henting av gudstjenester', kommende.error);
      $('gudstjenesteListe').replaceChildren(el('p', { class: 'felt-feil' }, `Kunne ikke hente gudstjenester: ${forklarFeil(kommende.error)}`));
    } else {
      tilstand.gudstjenester = kommende.data;
      tegnGudstjenester();
    }

    if (innspill.error) {
      loggFeil('henting av innspill', innspill.error);
      $('innspillListe').replaceChildren(el('p', { class: 'felt-feil' }, `Kunne ikke hente innspill: ${forklarFeil(innspill.error)}`));
    } else {
      tegnInnspill(innspill.data);
    }
  }

  function velgMenighet(menighetId) {
    const rolle = tilstand.roller.find((r) => r.menighet_id === menighetId) || tilstand.roller[0];
    tilstand.menighet = rolle;
    $('menighetVelger').value = rolle.menighet_id;
    try { localStorage.setItem(VALGT_NOKKEL, rolle.menighet_id); } catch (e) { /* ikke kritisk */ }
    $('menighetNavn').textContent = [rolle.menighet?.navn, rolle.menighet?.kommune].filter(Boolean).join(', ');
    document.title = `KirkePulsen – ${rolle.menighet?.navn ?? 'prestens side'}`;
    nullstillSkjema();
    lastMenighet();
  }

  async function startForBruker(bruker) {
    const { data: roller, error } = await data.hentRoller(bruker.id);
    if (error) {
      loggFeil('henting av prestetilgang', error);
      visSkjerm('innlogging');
      visMelding(`Kunne ikke hente tilgangen din: ${forklarFeil(error)}`, 'feil');
      return;
    }
    if (!roller.length) {
      visSkjerm('innlogging');
      $('innlogging').hidden = true;
      $('loggUtKnapp').hidden = false;
      visMelding(`${bruker.email} er logget inn, men er ikke registrert som prest i noen menighet. Ta kontakt med den som administrerer KirkePulsen.`, 'feil');
      return;
    }

    tilstand.roller = roller.sort((a, b) => (a.menighet?.navn ?? '').localeCompare(b.menighet?.navn ?? '', 'nb'));
    $('menighetVelger').replaceChildren(...tilstand.roller.map((r) =>
      el('option', { value: r.menighet_id }, [r.menighet?.navn, r.menighet?.kommune].filter(Boolean).join(', '))));
    $('velgerBoks').hidden = tilstand.roller.length < 2;

    let lagret = null;
    try { lagret = localStorage.getItem(VALGT_NOKKEL); } catch (e) { /* ikke kritisk */ }

    visSkjerm('dashbord');
    velgMenighet(lagret);
  }

  async function loggInn(e) {
    e.preventDefault();
    skjulMelding();
    const epost = $('epost').value.trim();
    const passord = $('passord').value;
    if (!epost || !passord) {
      visMelding('Fyll inn både e-post og passord.', 'feil');
      (epost ? $('passord') : $('epost')).focus();
      return;
    }

    const knapp = $('loggInnKnapp');
    settOpptatt(knapp, true, 'Logger inn …');
    try {
      const { data: svar, error } = await db.auth.signInWithPassword({ email: epost, password: passord });
      if (error) {
        loggFeil('innlogging', error);
        visMelding(error.message === 'Invalid login credentials'
          ? 'E-post eller passord stemmer ikke.'
          : `Innloggingen feilet: ${forklarFeil(error)}`, 'feil');
        $('passord').focus();
        return;
      }
      $('passord').value = '';
      await startForBruker(svar.user);
      $('innhold').focus();
    } finally {
      settOpptatt(knapp, false);
    }
  }

  async function loggUt() {
    await db.auth.signOut();
    tilstand.roller = [];
    tilstand.menighet = null;
    skjulMelding();
    $('velgerBoks').hidden = true;
    $('menighetNavn').textContent = 'Prestens side';
    visSkjerm('innlogging');
    $('epost').focus();
  }

  async function lagreGudstjeneste(e) {
    e.preventDefault();
    skjulMelding();

    const tittel = $('tittel').value.trim();
    const datoVerdi = $('dato').value;
    const redigerId = $('redigerId').value;

    // Kontroller feltene før noe sendes.
    let forsteFeil = null;
    settFeltFeil('tittel', tittel ? '' : 'Skriv en tittel.');
    if (!tittel) forsteFeil = forsteFeil || 'tittel';

    const dato = datoVerdi ? new Date(datoVerdi) : null;
    let datoFeil = '';
    if (!dato) datoFeil = 'Velg dato og klokkeslett.';
    else if (dato < new Date()) datoFeil = 'Datoen har allerede vært. Velg et tidspunkt fram i tid.';
    settFeltFeil('dato', datoFeil);
    if (datoFeil) forsteFeil = forsteFeil || 'dato';

    if (forsteFeil) { $(forsteFeil).focus(); return; }

    const rad = {
      tittel,
      beskrivelse: $('beskrivelse').value.trim() || null,
      sporsmal_fra_prest: $('sporsmal').value.trim() || null,
      dato_tid: dato.toISOString(),
      svarfrist: beregnSvarfrist(dato).toISOString(),
    };

    const knapp = $('lagreKnapp');
    settOpptatt(knapp, true, redigerId ? 'Lagrer …' : 'Publiserer …');
    try {
      const svar = redigerId
        ? await data.oppdater(redigerId, rad)
        : await data.opprett({ ...rad, menighet_id: tilstand.menighet.menighet_id });

      if (svar.error || (redigerId && !svar.data?.length)) {
        loggFeil(redigerId ? 'oppdatering av gudstjeneste' : 'publisering av gudstjeneste', svar.error);
        visMelding(`${redigerId ? 'Endringen ble ikke lagret' : 'Gudstjenesten ble ikke publisert'}: ${forklarFeil(svar.error || { message: 'Fant ikke gudstjenesten.' })}`, 'feil');
        return;
      }

      visMelding(redigerId
        ? `Endringene i «${tittel}» er lagret.`
        : `«${tittel}» er publisert for ${lesbarDato(dato)}.`, 'ok');
      nullstillSkjema();
      await lastMenighet();
    } catch (err) {
      console.error(`${LOGG} Uventet feil ved lagring:`, err);
      visMelding(forklarFeil(err), 'feil');
    } finally {
      settOpptatt(knapp, false);
      knapp.textContent = $('redigerId').value ? 'Lagre endringer' : 'Publiser';
    }
  }

  async function slettGudstjeneste(g, knapp) {
    settOpptatt(knapp, true, 'Sletter …');
    const { data: slettet, error } = await data.slett(g.id);
    if (error || !slettet?.length) {
      loggFeil('sletting av gudstjeneste', error);
      settOpptatt(knapp, false);
      visMelding(`«${g.tittel}» ble ikke slettet: ${forklarFeil(error || { message: 'Fant ikke gudstjenesten.' })}`, 'feil');
      return;
    }
    if ($('redigerId').value === g.id) nullstillSkjema();
    visMelding(`«${g.tittel}» ${lesbarDato(g.dato_tid)} er slettet.`, 'ok');
    await lastMenighet();
    $('kommendeTittel').focus?.();
  }

  // ---------------------------------------------------------------------------
  // Oppstart
  // ---------------------------------------------------------------------------

  async function start() {
    $('innloggingSkjema').addEventListener('submit', loggInn);
    $('gudstjenesteSkjema').addEventListener('submit', lagreGudstjeneste);
    $('avbrytKnapp').addEventListener('click', () => { nullstillSkjema(); skjulMelding(); });
    $('loggUtKnapp').addEventListener('click', loggUt);
    $('menighetVelger').addEventListener('change', (e) => { skjulMelding(); velgMenighet(e.target.value); });
    $('dato').addEventListener('input', () => { settFeltFeil('dato', ''); oppdaterFristForklaring(); });
    $('tittel').addEventListener('input', () => settFeltFeil('tittel', ''));
    $('kommendeTittel').setAttribute('tabindex', '-1');
    $('innspillTittel').setAttribute('tabindex', '-1');

    if (!db) {
      visSkjerm('innlogging');
      visMelding('Kunne ikke laste nødvendige filer. Sjekk nettforbindelsen, eller om en annonseblokker stopper siden.', 'feil');
      return;
    }

    db.auth.onAuthStateChange((hendelse) => {
      if (hendelse === 'SIGNED_OUT' && tilstand.roller.length) loggUt();
    });

    try {
      const { data: { session } } = await db.auth.getSession();
      if (session) await startForBruker(session.user);
      else { visSkjerm('innlogging'); }
    } catch (err) {
      console.error(`${LOGG} Oppstart feilet:`, err);
      visSkjerm('innlogging');
      visMelding('Fikk ikke kontakt med serveren. Sjekk nettforbindelsen og last siden på nytt.', 'feil');
    }
  }

  start();
})();
