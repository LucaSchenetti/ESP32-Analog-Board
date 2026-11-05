/*
  IO Tester — pagina "Autotest" / "Self-test" page
  IT: Verifica dello strumento in loopback (uscite collegate agli ingressi con 4 fili): test SPI di AD5412 e
      ADS1220, controllo del collegamento, tensione 1/5/9 V, corrente 4/12/20 mA, rumore, FAULT, uscite spente;
      prova facoltativa del sink 2F con un secondo collegamento. Valori calibrati (/api/out/*, /api/state),
      letture sempre nuove (attesa di 12 conversioni). Risultato: STRUMENTO OK / DA CONTROLLARE, salvato nel browser.
  EN: Loopback check of the instrument (outputs wired to inputs with 4 wires): AD5412 and ADS1220 SPI tests,
      wiring check, voltage 1/5/9 V, current 4/12/20 mA, noise, FAULT, outputs off; optional 2W sink test with a
      second wiring. Calibrated values (/api/out/*, /api/state), always fresh readings (wait for 12 conversions).
      Result: INSTRUMENT OK / TO CHECK, stored in the browser.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

// IT: Limiti di accettazione (metà del budget ±0,3% circa) / EN: Acceptance limits (about half of the ±0.3% budget)
const LIM = {
  v: 0.010,       // V: 0,1% di 10 V / 0.1% of 10 V
  i: 0.030,       // mA: 0,15% di 20 mA / 0.15% of 20 mA
  s: 0.050,       // mA: sink 0,25% di 20 mA / sink 0.25% of 20 mA
  vNoise: 0.001,  // V picco-picco / peak-to-peak
  iNoise: 0.002,  // mA picco-picco / peak-to-peak
  off: 0.05,      // V o mA residui a uscita spenta / V or mA left with output off
};
const LAST_KEY = 'iotester.autotest.last';

let running = false;
let abort = false;
let results = [];
let lastState = null;
let wiring = 'main';
let mainDone = false;   // IT: prova principale finita senza errori / EN: main test finished without errors   // IT: 'main' (4 fili) o 'sink' (2F) / EN: 'main' (4 wires) or 'sink' (2W)

// ── Disegno dei collegamenti / Wiring diagram ─────────────────────────────

const P1 = { 'P1.1 COM': 80, 'P1.2 SIM+': 125, 'P1.3 mA+': 170, 'P1.4 V+': 215 };
const P2 = { 'P2.1 V−': 60, 'P2.2 V+': 105, 'P2.3 mA−': 150, 'P2.4 mA+': 195, 'P2.5 L+': 240 };

// IT: Fili: numero, classe (colore), percorso SVG, posizione del numero, morsetti usati
// EN: Wires: number, class (colour), SVG path, number position, terminals used
const WIRES = {
  main: [
    { n: 1, cls: 'wr-pos', d: 'M131,215 H330 V105 H355', at: [232, 215], key: 'at_w1' },
    // IT: il filo blu "salta" sopra il rosso / EN: the blue wire "hops" over the red one
    { n: 2, cls: 'wr-cur', d: 'M131,170 H240 V195 H321 A9,9 0 0 1 339,195 H355', at: [186, 170], key: 'at_w2' },
    { n: 3, cls: 'wr-com', d: 'M131,80 H215 V60 H355', at: [172, 80], key: 'at_w3' },
    { n: 4, cls: 'wr-com', d: 'M373,60 H388 V150 H373', at: [388, 105], key: 'at_w4' },
  ],
  sink: [
    { n: 5, cls: 'wr-pos', d: 'M131,125 H180 V240 H355', at: [180, 180], key: 'at_w5' },
    { n: 6, cls: 'wr-com', d: 'M131,80 H215 V195 H355', at: [172, 80], key: 'at_w6' },
  ],
};
const USED = {
  main: ['P1.1 COM', 'P1.3 mA+', 'P1.4 V+', 'P2.1 V−', 'P2.2 V+', 'P2.3 mA−', 'P2.4 mA+'],
  sink: ['P1.1 COM', 'P1.2 SIM+', 'P2.4 mA+', 'P2.5 L+'],
};

/**
 * IT: Disegna il collegamento scelto: morsettiere P1 e P2, fili colorati numerati, morsetti liberi in grigio.
 * EN: Draws the chosen wiring: P1 and P2 terminal blocks, numbered coloured wires, free terminals in grey.
 */
function renderWiring() {
  const w = WIRES[wiring];
  const used = USED[wiring];
  const o = [];
  o.push(`<text class="wr-title" x="122" y="28" text-anchor="middle">P1 OUTPUT</text>`);
  o.push('<rect class="wr-strip" x="110" y="56" width="24" height="182" rx="5"/>');
  o.push(`<text class="wr-title" x="364" y="24" text-anchor="middle">P2 INPUT</text>`);
  o.push('<rect class="wr-strip" x="352" y="40" width="24" height="222" rx="5"/>');
  const term = (name, x, y, lx, anchor) => {
    const u = used.includes(name);
    o.push(`<circle class="wr-term${u ? ' used' : ''}" cx="${x}" cy="${y}" r="8"/>`);
    o.push(`<text class="wr-label${u ? '' : ' free'}" x="${lx}" y="${y + 4}" text-anchor="${anchor}">${name}</text>`);
  };
  Object.entries(P1).forEach(([n, y]) => term(n, 122, y, 100, 'end'));
  Object.entries(P2).forEach(([n, y]) => term(n, 364, y, 402, 'start'));
  w.forEach((x) => o.push(`<path class="${x.cls}" d="${x.d}"/>`));
  w.forEach((x) => o.push(`<path class="wr-flow${x.cls === 'wr-com' ? ' com' : ''}" d="${x.d}"/>`));
  w.forEach((x) => {
    o.push(`<circle class="wr-badge ${x.cls}-b" cx="${x.at[0]}" cy="${x.at[1]}" r="11"/>`);
    o.push(`<text class="wr-badge-t" x="${x.at[0]}" y="${x.at[1] + 4.5}" text-anchor="middle">${x.n}</text>`);
  });
  $('wiring').innerHTML = o.join('');
  $('wire-list').innerHTML = w.map((x) =>
    `<li><span class="wl-n ${x.cls}-b">${x.n}</span><span>${t(x.key)}</span></li>`).join('');
  $('wr-mode').textContent = t(wiring === 'main' ? 'at_wr_main' : 'at_wr_sink');
  $('wr-note').textContent = t(wiring === 'main' ? 'at_wr_note_main' : 'at_wr_note_sink');
}

// ── Procedura / Procedure ───────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * IT: Comando POST con risposta JSON; errore se la risposta non è 200. EN: POST command with JSON reply; error if not 200.
 */
function post(url) {
  return request(url, { method: 'POST' });
}

/**
 * IT: Attende 12 nuove conversioni (media mobile di 10 letture tutta nuova) e restituisce lo stato.
 * EN: Waits for 12 new conversions (moving average of 10 readings fully renewed) and returns the state.
 */
async function freshState() {
  await sleep(600);   // IT: assestamento uscita e filtro d'ingresso / EN: output and input filter settling
  const n0 = (await request(API.state)).in.n;
  const t0 = Date.now();
  for (;;) {
    if (abort) throw new Error('abort');
    const s = await request(API.state);
    lastState = s;
    if (s.in.n >= n0 + 12) return s;
    if (Date.now() - t0 > 8000) throw new Error(t('at_e_adc'));
    await sleep(300);
  }
}

/**
 * IT: Aggiunge un risultato alla tabella. EN: Adds a result to the table.
 */
function addResult(r) {
  results.push(r);
  renderResults();
}

/**
 * IT: Mostra il passo in corso e l'avanzamento. EN: Shows the current step and the progress.
 */
function step(text, k, n) {
  $('at-step').innerHTML = `<span class="spinner"></span>${text}`;
  $('at-bar').style.width = `${(k / n) * 100}%`;
}

/**
 * IT: Misura un punto: imposta l'uscita, legge l'ingresso, confronta con il valore atteso dell'uscita.
 * EN: Measures one point: sets the output, reads the input, compares with the expected output value.
 */
async function point(kind, value) {
  const api = kind === 'v' ? API.outV : kind === 'i' ? API.outI : API.outSink;
  await post(`${api}?value=${value}`);
  const s = await freshState();
  const read = kind === 'v' ? s.in.v : s.in.i;
  const exp = s.out.value;
  const dev = read - exp;
  const unit = kind === 'v' ? 'V' : 'mA';
  const sub = kind === 'v' ? 'mV' : 'µA';
  const lim = LIM[kind];
  addResult({
    name: t(kind === 'v' ? 'at_r_v' : kind === 'i' ? 'at_r_i' : 'at_r_s', { x: fmt(value, 0) }),
    exp: `${fmt(exp, 4)} ${unit}`,
    read: `${fmt(read, 4)} ${unit}`,
    dev: `${dev >= 0 ? '+' : ''}${fmt(dev * 1000, 1)} ${sub}`,
    lim: `±${fmt(lim * 1000, 0)} ${sub}`,
    ok: Math.abs(dev) <= lim && !(kind === 'i' && s.out.fault),
  });
  return s;
}

/**
 * IT: Controlla il collegamento con un primo punto (fuori di oltre 10% → filo mancante) e interrompe con un messaggio chiaro.
 * EN: Checks the wiring with a first point (more than 10% off → missing wire) and stops with a clear message.
 */
async function wiringCheck(kind, value, msgKey) {
  const api = kind === 'v' ? API.outV : kind === 'i' ? API.outI : API.outSink;
  await post(`${api}?value=${value}`);
  const s = await freshState();
  const read = kind === 'v' ? s.in.v : s.in.i;
  if (Math.abs(read - value) > value * 0.1) {
    const unit = kind === 'v' ? 'V' : 'mA';
    throw new Error(t(msgKey, { r: `${fmt(read, 3)} ${unit}`, x: `${fmt(value, 0)} ${unit}` }));
  }
}

/**
 * IT: Procedura principale (collegamento a 4 fili). EN: Main procedure (4-wire connection).
 */
async function runMain() {
  const N = 11;
  step(t('at_s_spi'), 0, N);
  const dac = await post('/api/dac/test');
  addResult({ name: t('at_r_spi_dac'), exp: '—', read: dac.ok ? 'OK' : t('dg_fail'), dev: '', lim: '', ok: !!dac.ok });
  step(t('at_s_spi'), 1, N);
  const adc = await post('/api/adc/test');
  addResult({ name: t('at_r_spi_adc'), exp: '—', read: adc.ok ? `OK · ${fmt(adc.temp_c, 1)} °C` : t('dg_fail'), dev: '', lim: '', ok: !!adc.ok });

  step(t('at_s_wire_v'), 2, N);
  await wiringCheck('v', 5, 'at_e_wire_v');
  let s = null;
  for (const [k, v] of [[3, 1], [4, 5], [5, 9]]) {
    step(t('at_s_v', { x: fmt(v, 0) }), k, N);
    s = await point('v', v);
  }
  const vn = s.in.v_max - s.in.v_min;
  addResult({ name: t('at_r_vnoise'), exp: '—', read: `${fmt(vn * 1000, 2)} mV`, dev: '', lim: `≤ ${fmt(LIM.vNoise * 1000, 0)} mV`, ok: vn <= LIM.vNoise });

  step(t('at_s_wire_i'), 6, N);
  await wiringCheck('i', 12, 'at_e_wire_i');
  for (const [k, v] of [[7, 4], [8, 12], [9, 20]]) {
    step(t('at_s_i', { x: fmt(v, 0) }), k, N);
    s = await point('i', v);
  }
  const inz = s.in.i_max - s.in.i_min;
  addResult({ name: t('at_r_inoise'), exp: '—', read: `${fmt(inz * 1000, 2)} µA`, dev: '', lim: `≤ ${fmt(LIM.iNoise * 1000, 0)} µA`, ok: inz <= LIM.iNoise });
  addResult({ name: t('at_r_fault'), exp: t('v_no'), read: s.out.fault ? t('v_yes') : t('v_no'), dev: '', lim: '', ok: !s.out.fault });

  step(t('at_s_off'), 10, N);
  await post(API.off);
  s = await freshState();
  const offOk = Math.abs(s.in.v) < LIM.off && Math.abs(s.in.i) < LIM.off;
  addResult({ name: t('at_r_off'), exp: '≈ 0', read: `${fmt(s.in.v, 3)} V · ${fmt(s.in.i, 3)} mA`, dev: '', lim: `< ${fmt(LIM.off, 2)}`, ok: offOk });
  step('', N, N);
  return s;
}

/**
 * IT: Prova facoltativa del sink 2F (secondo collegamento). EN: Optional 2W sink test (second wiring).
 */
async function runSink() {
  const N = 5;
  step(t('at_s_wire_s'), 0, N);
  await wiringCheck('s', 12, 'at_e_wire_s');
  for (const [k, v] of [[1, 4], [2, 12], [3, 20]]) {
    step(t('at_s_s', { x: fmt(v, 0) }), k, N);
    await point('s', v);
  }
  step(t('at_s_off'), 4, N);
  await post(API.off);
  step('', N, N);
}

/**
 * IT: Esegue una procedura gestendo interruzione ed errori; alla fine spegne sempre le uscite.
 * EN: Runs a procedure handling abort and errors; at the end it always switches the outputs off.
 */
async function run(which) {
  if (running) return;
  running = true;
  abort = false;
  if (which === 'main') results = [];
  renderAll();
  let err = '';
  let s = null;
  try {
    if (which === 'main') s = await runMain();
    else await runSink();
  } catch (e) {
    err = e.message === 'abort' ? t('at_aborted') : e.message || t('cmd_fail');
  }
  try { await post(API.off); } catch (e) { /* IT/EN: spegnimento di sicurezza / safety switch-off */ }
  running = false;
  const ok = !err && results.length > 0 && results.every((r) => r.ok);
  if (which === 'main') mainDone = !err;
  const rec = { date: Date.now(), ok, err, fw: lastState ? lastState.fw : '', temp: s ? s.temp : lastState ? lastState.temp : null, sink: which === 'sink', results };
  try { localStorage.setItem(LAST_KEY, JSON.stringify(rec)); } catch (e) { /* IT/EN: opzionale / optional */ }
  renderSummary(rec);
  renderAll();
}

// ── Visualizzazione / Rendering ───────────────────────────────────────────

/**
 * IT: Tabella dei risultati. EN: Results table.
 */
function renderResults() {
  $('at-table').hidden = results.length === 0;
  $('at-rows').innerHTML = results.map((r) => `<tr class="${r.ok ? '' : 'ko'}">
      <td><span class="dot ${r.ok ? 'ok' : 'err'}"></span>${r.name}</td><td>${r.exp}</td><td>${r.read}</td><td>${r.dev}</td><td>${r.lim}</td></tr>`).join('');
}

/**
 * IT: Riquadro del risultato finale (o dell'ultimo autotest salvato). EN: Final result box (or the last saved self-test).
 */
function renderSummary(rec) {
  const box = $('at-sum');
  if (!rec) { box.hidden = true; return; }
  box.hidden = false;
  box.className = `at-sum ${rec.ok ? 'ok' : 'ko'}`;
  const d = new Date(rec.date);
  $('at-sum-t').textContent = t(rec.ok ? 'at_ok' : 'at_ko');
  $('at-sum-d').textContent = [
    `${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`,
    rec.temp !== null && rec.temp !== undefined ? `${fmt(rec.temp, 1)} °C` : '',
    rec.fw ? `Firmware ${rec.fw}` : '',
    t('at_n_ok', { a: rec.results.filter((r) => r.ok).length, b: rec.results.length }),
  ].filter(Boolean).join(' · ');
  $('at-sum-e').textContent = rec.err || '';
  $('at-sum-e').hidden = !rec.err;
}

/**
 * IT: Stato di pulsanti, avanzamento, disegno e stato in alto. EN: State of buttons, progress, drawing and top state.
 */
function renderAll() {
  renderWiring();
  $('wiring').classList.toggle('is-on', running);
  const ready = $('chk-wire').checked && $('chk-free').checked;
  $('at-go').disabled = running || !ready;
  $('at-go').textContent = t(wiring === 'main' ? 'at_go' : 'at_go_s');
  $('at-stop').hidden = !running;
  $('at-prog').hidden = !running;
  $('at-sink').hidden = running || wiring !== 'main' || !mainDone;
  $('at-back').hidden = running || wiring !== 'sink';
  ['chk-wire', 'chk-free'].forEach((id) => { $(id).disabled = running; });
  const chip = $('state');
  chip.className = `state-chip${running ? ' on' : ''}`;
  chip.dataset.i18n = running ? 'cal_st_run' : 'cal_st_idle';
  chip.textContent = t(chip.dataset.i18n);
  renderResults();
}

document.addEventListener('DOMContentLoaded', () => {
  initChrome(() => {
    renderAll();
    try { renderSummary(JSON.parse(localStorage.getItem(LAST_KEY) || 'null')); } catch (e) { /* IT/EN: opzionale / optional */ }
  }, (s) => { lastState = s; renderBanner(s.out); $('fw').textContent = s.fw; });
  try {
    const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
    if (last) { results = []; renderSummary(last); }
  } catch (e) { /* IT/EN: opzionale / optional */ }

  ['chk-wire', 'chk-free'].forEach((id) => $(id).addEventListener('change', renderAll));
  $('at-go').addEventListener('click', () => run(wiring));
  $('at-stop').addEventListener('click', () => { abort = true; });
  $('at-sink').addEventListener('click', () => {
    // IT: secondo collegamento: si riconferma il cablaggio / EN: second wiring: the wiring is confirmed again
    wiring = 'sink';
    $('chk-wire').checked = false;
    renderAll();
    $('p-wr').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('at-back').addEventListener('click', () => {
    wiring = 'main';
    $('chk-wire').checked = false;
    renderAll();
  });
  renderAll();
  startPolling((s) => { lastState = s; renderBanner(s.out); $('fw').textContent = s.fw; });
});
