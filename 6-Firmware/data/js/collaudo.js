/*
  IO Tester — pagina "Collaudo" / "Bench test" page
  IT: Banco di prova tecnico. Uscite AD5412 in tensione e corrente SENZA calibrazione (/api/dac/out, codice dal
      valore nominale) e sink 2 fili nominale (raw=1), con rilettura di codice, registri e FAULT (/api/dac/status);
      ingressi ADS1220 con valori nominali, min…max, codici e contatori (/api/state); alimentazione grezza
      (/api/power); LED RGB (fino a 60 s) e LED di test; cicalino (beep, continuo, sweep).
  EN: Technical bench page. AD5412 voltage and current outputs WITHOUT calibration (/api/dac/out, code from the
      nominal value) and nominal 2-wire sink (raw=1), with read-back of code, registers and FAULT (/api/dac/status);
      ADS1220 inputs with nominal values, min…max, codes and counters (/api/state); raw supply (/api/power);
      RGB LED (up to 60 s) and test LED; buzzer (beep, continuous, sweep).
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

// IT: Modi d'uscita: campo, unità, valori rapidi, collegamento / EN: Output modes: range, unit, quick values, wiring
const MODES = {
  v: { min: 0, max: 10, unit: 'V', def: 5, quick: [0, 2.5, 5, 7.5, 10], hint: 'P1.4 V+ · P1.1 COM' },
  i: { min: 4, max: 20, unit: 'mA', def: 12, quick: [4, 8, 12, 16, 20], hint: 'P1.3 mA+ · P1.1 COM' },
  s: { min: 0, max: 22, unit: 'mA', def: 12, quick: [4, 8, 12, 16, 20], hint: 'P1.2 SIM+ · P1.1 COM · 2,391 mA/V' },
};
const SPKEY = 'iotester.bench';

let mode = 'v';
let dac = null;        // IT: ultimo /api/dac/status / EN: last /api/dac/status
let lastState = null;
let stopSweep = false;

/**
 * IT: Esadecimale a 4 cifre. EN: 4-digit hexadecimal.
 */
function hex4(x) {
  return `0x${x.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * IT: POST senza risposta attesa; errore → stato di connessione. EN: POST with no expected reply; error → connection state.
 */
function post(url) {
  return fetch(url, { method: 'POST', cache: 'no-store' }).catch(() => setConn('cmd_fail', 'err'));
}

/**
 * IT: Seleziona il modo d'uscita (solo il campo: l'uscita cambia premendo IMPOSTA o un valore rapido).
 * EN: Selects the output mode (field only: the output changes when SET or a quick value is pressed).
 */
function selectMode(m) {
  mode = m;
  const c = MODES[m];
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('bt-unit').textContent = c.unit;
  $('mode-hint').textContent = c.hint;
  let v = c.def;
  try { v = Number(JSON.parse(localStorage.getItem(SPKEY) || '{}')[m] ?? c.def); } catch (e) { /* IT/EN: opzionale / optional */ }
  $('bt-val').value = fmt(v, 3);
  $('bt-err').textContent = '';
  $('bt-field').classList.remove('err');
  $('bt-quick').innerHTML = c.quick.map((q) => `<button class="btn" type="button" data-q="${q}">${fmt(q, q % 1 ? 1 : 0)}</button>`).join('');
}

/**
 * IT: Legge il valore del campo (virgola o punto); null se fuori campo. EN: Reads the field value (comma or dot); null if out of range.
 */
function readValue() {
  const c = MODES[mode];
  const raw = $('bt-val').value.trim().replace(',', '.');
  const v = Number(raw);
  const ok = raw !== '' && Number.isFinite(v) && v >= c.min && v <= c.max;
  $('bt-field').classList.toggle('err', !ok);
  $('bt-err').textContent = ok ? '' : t('sp_err', { min: fmt(c.min, 0), max: fmt(c.max, 0), u: c.unit });
  return ok ? v : null;
}

/**
 * IT: Imposta l'uscita senza calibrazione e mostra la rilettura. EN: Sets the output without calibration and shows the read-back.
 */
async function setOutput(v) {
  if (v === null) return;
  try {
    const s = JSON.parse(localStorage.getItem(SPKEY) || '{}');
    s[mode] = v;
    localStorage.setItem(SPKEY, JSON.stringify(s));
  } catch (e) { /* IT/EN: opzionale / optional */ }
  const raw = mode === 's' ? '&raw=1' : '';
  try {
    renderDac(await request(`/api/dac/out?m=${mode}&x=${v}${raw}`, { method: 'POST' }));
  } catch (e) {
    setConn('cmd_fail', 'err');
  }
}

/**
 * IT: Rilettura AD5412: modo, valore teorico, codici, registri, FAULT, stato in alto.
 * EN: AD5412 read-back: mode, theoretical value, codes, registers, FAULT, top state.
 */
function renderDac(d) {
  dac = d;
  const on = d.sink || d.mode !== 0;
  const key = d.sink ? 'bt_m_s' : ['bt_m_off', 'bt_m_v', 'bt_m_i', 'bt_m_i0', 'bt_m_i24'][d.mode];
  setRow('mode', t(key), on ? 'warn' : '');
  const th = d.sink ? `${fmt(d.sink_ma, 4)} mA (${fmt(d.theory, 4)} V)` : d.mode === 1 ? `${fmt(d.theory, 4)} V` : d.mode >= 2 ? `${fmt(d.theory, 4)} mA` : '–';
  setRow('theory', th);
  setRow('code', on ? `${d.code} / ${d.code_rb}` : '–', on ? (d.code === d.code_rb ? 'ok' : 'err') : '');
  setRow('ctrl', hex4(d.ctrl_rb));
  const bits = [];
  if (d.status_rb & 4) bits.push(t('k_iout_fault'));
  if (d.status_rb & 1) bits.push(t('k_overtemp'));
  setRow('sts', `${hex4(d.status_rb)}${bits.length ? ` · ${bits.join(', ')}` : ''}`);
  setRow('fault', d.fault ? t('v_yes') : t('v_no'), d.fault ? 'err' : 'ok');
  const chip = $('state');
  chip.className = `state-chip${d.fault ? ' err' : on ? ' on' : ''}`;
  chip.dataset.i18n = d.fault ? 'bt_st_fault' : on ? 'bt_st_on' : 'bt_st_off';
  chip.textContent = t(chip.dataset.i18n);
  $('p-out').classList.toggle('is-on', on);
}

/**
 * IT: Ingressi ADS1220 da /api/state. EN: ADS1220 inputs from /api/state.
 */
function renderInputs(s) {
  lastState = s;
  const n = s.in;
  $('st-vn').textContent = `${fmt(n.v_nom, 4)} V`;
  $('st-vc').textContent = t('bt_cal_val', { v: `${fmt(n.v, 4)} V` });
  $('st-in').textContent = `${fmt(n.i_nom, 4)} mA`;
  $('st-ic').textContent = t('bt_cal_val', { v: `${fmt(n.i, 4)} mA` });
  setRow('vrng', `${fmt(n.v_min, 4)}…${fmt(n.v_max, 4)}`);
  setRow('irng', `${fmt(n.i_min, 4)}…${fmt(n.i_max, 4)}`);
  setRow('cv', String(n.code_v));
  setRow('ci', String(n.code_i));
  const fl = [];
  if (n.sat_v) fl.push(`V ${t('ms_sat')}`);
  if (n.sat_i) fl.push(`I ${t('ms_sat')}`);
  if (n.v < -0.05) fl.push(`V ${t('ms_neg')}`);
  if (n.i < -0.05) fl.push(`I ${t('ms_neg')}`);
  setRow('flags', fl.length ? fl.join(' · ') : t('v_no'), fl.length ? 'err' : 'ok');
  setRow('atemp', s.temp === null ? '–' : `${fmt(s.temp, 2)} °C`);
  setRow('conv', `${n.n.toLocaleString(locale())} / ${n.err}`, n.err ? 'warn' : 'ok');
  $('fw').textContent = s.fw;
  renderBanner(s.out);
}

/**
 * IT: Ogni secondo: rilettura AD5412 e alimentazione grezza. EN: Every second: AD5412 read-back and raw supply.
 */
async function pollExtra() {
  try {
    const [d, p] = await Promise.all([request('/api/dac/status'), request('/api/power')]);
    renderDac(d);
    setRow('vusb', `${fmt(p.vusb_mv / 1000, 3)} V`);
    setRow('pin', `${p.pin_mv} mV`);
    setRow('att', `ATTEN${p.atten}`);
    setRow('g17', p.ext24 ? t('bt_high') : t('bt_low'), p.ext24 ? 'ok' : '');
    setRow('g18', p.ext5 ? t('bt_high') : t('bt_low'), p.ext5 ? 'ok' : '');
  } catch (e) { /* IT: riprova / EN: retry */ }
  setTimeout(pollExtra, 1000);
}

/**
 * IT: Anteprima del colore e valori dei cursori. EN: Colour preview and slider values.
 */
function rgbPreview() {
  const [r, g, b] = ['lr', 'lg', 'lb'].map((id) => Number($(id).value));
  ['lr', 'lg', 'lb'].forEach((id) => { $(`${id}-v`).textContent = $(id).value; });
  // IT: anteprima indicativa (il LED reale ha resistenze diverse per colore) / EN: indicative preview (the real LED has different resistors per colour)
  $('rgb-swatch').style.background = `rgb(${r}, ${g}, ${b})`;
  return [r, g, b];
}

document.addEventListener('DOMContentLoaded', () => {
  initChrome(() => {
    selectMode(mode);
    if (dac) renderDac(dac);
    if (lastState) renderInputs(lastState);
  }, renderInputs);
  selectMode('v');

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => selectMode(b.dataset.mode)));
  $('bt-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    $('bt-val').value = fmt(Number(b.dataset.q), 3);
    setOutput(readValue());
  });
  $('bt-val').addEventListener('keydown', (e) => { if (e.key === 'Enter') setOutput(readValue()); });
  $('bt-val').addEventListener('input', readValue);
  $('bt-set').addEventListener('click', () => setOutput(readValue()));
  $('bt-off').addEventListener('click', async () => {
    try { renderDac(await request('/api/dac/off', { method: 'POST' })); } catch (e) { setConn('cmd_fail', 'err'); }
  });

  ['lr', 'lg', 'lb'].forEach((id) => $(id).addEventListener('input', rgbPreview));
  rgbPreview();
  $('rgb-apply').addEventListener('click', () => {
    const [r, g, b] = rgbPreview();
    post(`/api/led?r=${r}&g=${g}&b=${b}&ms=60000`);
  });
  $('rgb-auto').addEventListener('click', () => post('/api/led?r=0&g=0&b=0&ms=1'));
  document.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', () => post(`/api/led?test=${b.dataset.test}`)));

  const freq = () => Number($('bz-f').value) || 4000;
  $('bz-beep').addEventListener('click', () => post(`/api/buzzer?f=${freq()}&ms=${Number($('bz-ms').value) || 300}`));
  $('bz-cont').addEventListener('click', () => post(`/api/buzzer?f=${freq()}`));
  $('bz-stop').addEventListener('click', () => { stopSweep = true; post('/api/buzzer?f=0'); $('bz-now').textContent = ''; });
  $('bz-sweep').addEventListener('click', async () => {
    // IT: 2–6 kHz a passi di 250 Hz (KLJ-4020: 4 kHz nominali) / EN: 2–6 kHz in 250 Hz steps (KLJ-4020: 4 kHz nominal)
    stopSweep = false;
    for (let f = 2000; f <= 6000 && !stopSweep; f += 250) {
      $('bz-now').textContent = `${f} Hz`;
      await post(`/api/buzzer?f=${f}&ms=250`);
      await new Promise((r) => setTimeout(r, 300));
    }
    $('bz-now').textContent = '';
  });

  startPolling(renderInputs);
  pollExtra();
});
