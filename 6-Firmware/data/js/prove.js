/*
  IO Tester — pagina "Prove Guidate" / "Guided Tests" page
  IT: Due prove "genera, misura e confronta" con uscita e ingresso usati insieme (domini isolati tra loro):
      - Convertitore / isolatore / barriera: stimolo su P1 a 0-25-50-75-100 % (anche in discesa), risposta del
        dispositivo letta su P2; errore in % del campo d'uscita, isteresi, esito con tolleranza;
      - Valvola / posizionatore: comando 4–20 mA a gradini, ritorno di posizione 4–20 mA; errore di posizione,
        isteresi, tempo di risposta t90 (risoluzione ≈ 0,5 s per la media dell'ingresso) e banda morta.
      Disegno dei collegamenti per ogni combinazione, grafico degli errori, copia dei risultati. Uscite sempre
      spente alla fine o all'interruzione. Configurazione nel browser.
  EN: Two "generate, measure and compare" tests using output and input together (domains isolated from each other):
      - Converter / isolator / barrier: stimulus on P1 at 0-25-50-75-100 % (also descending), device response read
        on P2; error in % of the output span, hysteresis, pass/fail with tolerance;
      - Valve / positioner: 4–20 mA command in steps, 4–20 mA position feedback; position error, hysteresis,
        t90 response time (≈ 0.5 s resolution due to the input averaging) and dead band.
      Wiring diagram for every combination, error chart, results copy. Outputs always switched off at the end
      or on abort. Configuration in the browser.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

// IT: Stimoli (uscite) / EN: Stimuli (outputs)
const OUTS = {
  v: { label: '0–10 V', api: () => API.outV, q: '', lo: 0, hi: 10, unit: 'V', plus: 'P1.4 V+' },
  i420: { label: '4–20 mA', api: () => API.outI, q: '', lo: 4, hi: 20, unit: 'mA', plus: 'P1.3 mA+' },
  i020: { label: '0–20 mA', api: () => API.outI, q: '&range=0', lo: 0, hi: 20, unit: 'mA', plus: 'P1.3 mA+' },
};
// IT: Risposte (ingressi): wire = collegamento (v, 4f, 2f) / EN: Responses (inputs): wire = connection (v, 4f, 2f)
const INS = {
  v: { label: '0–10 V', field: 'v', lo: 0, hi: 10, unit: 'V', wire: 'v' },
  i4: { label: '4–20 mA · 4F', field: 'i', lo: 4, hi: 20, unit: 'mA', wire: '4f' },
  i0: { label: '0–20 mA · 4F', field: 'i', lo: 0, hi: 20, unit: 'mA', wire: '4f' },
  i2: { label: '4–20 mA · 2F', field: 'i', lo: 4, hi: 20, unit: 'mA', wire: '2f' },
};
const CFG_KEY = 'iotester.tests';

const cfg = { mode: 'conv', out: 'i420', in: 'i4', down: true, tol: 0.5, settle: 2, vin: 'i2', vstep: 25, vtimeout: 60 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { /* IT/EN: opzionale / optional */ }

let running = false;
let abort = false;
let rows = [];          // IT: risultati per punto / EN: results per point
let summary = null;     // IT: riepilogo / EN: summary
let trend = [];         // IT: valvola: campioni { t, cmd, pos } / EN: valve: samples { t, cmd, pos }
let lastState = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * IT: Salva la configurazione. EN: Saves the configuration.
 */
function saveCfg() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* IT/EN: opzionale / optional */ }
}

/**
 * IT: Uscita e ingresso della prova scelta. EN: Output and input of the chosen test.
 */
function io() {
  return cfg.mode === 'conv' ? { o: OUTS[cfg.out], i: INS[cfg.in] } : { o: OUTS.i420, i: INS[cfg.vin] };
}

// ── Disegno dei collegamenti / Wiring diagram ─────────────────────────────

/**
 * IT: Disegna strumento → dispositivo → strumento: a sinistra i morsetti P1 usati, al centro il dispositivo,
 *     a destra i morsetti P2 usati; fili diritti numerati, senza incroci.
 * EN: Draws instrument → device → instrument: P1 terminals used on the left, the device in the middle,
 *     P2 terminals used on the right; straight numbered wires, no crossings.
 */
function renderWiring() {
  const { o, i } = io();
  const valve = cfg.mode === 'valve';
  const p2 = i.wire === 'v' ? ['P2.2 V+', 'P2.1 V−'] : i.wire === '4f' ? ['P2.4 mA+', 'P2.3 mA−'] : ['P2.5 L+', 'P2.4 mA+'];
  // IT: dentro il dispositivo etichette brevi; l'elenco dei fili usa i nomi completi
  // EN: short labels inside the device; the wire list uses the full names
  const inLbl = ['IN +', 'IN −'];
  const outLbl = ['OUT +', 'OUT −'];
  const inName = valve ? [t('pg_cmd_p'), t('pg_cmd_m')] : inLbl;
  const outName = valve ? [t('pg_fb_p'), t('pg_fb_m')] : outLbl;
  // IT: nel 2F la corrente esce da L+ verso OUT+ / EN: in 2W the current leaves L+ towards OUT+
  const wires = [
    { n: 1, cls: 'wr-pos', d: 'M91,100 H150', at: [121, 100], txt: `${o.plus} → ${inName[0]}` },
    { n: 2, cls: 'wr-com', d: 'M91,160 H150', at: [121, 160], txt: `P1.1 COM → ${inName[1]}` },
    { n: 3, cls: i.wire === '2f' ? 'wr-pos' : 'wr-cur', d: 'M320,100 H379', at: [350, 100],
      txt: i.wire === '2f' ? `${p2[0]} → ${outName[0]}` : `${outName[0]} → ${p2[0]}` },
    { n: 4, cls: i.wire === '2f' ? 'wr-cur' : 'wr-com', d: 'M320,160 H379', at: [350, 160], txt: `${outName[1]} → ${p2[1]}` },
  ];
  const sv = [];
  sv.push(`<text class="wr-title" x="82" y="44" text-anchor="middle">P1</text>`);
  sv.push('<rect class="wr-strip" x="70" y="70" width="24" height="120" rx="5"/>');
  sv.push(`<text class="wr-title" x="388" y="44" text-anchor="middle">P2</text>`);
  sv.push('<rect class="wr-strip" x="376" y="70" width="24" height="120" rx="5"/>');
  [[o.plus, 100], ['P1.1 COM', 160]].forEach(([n, y]) => {
    sv.push(`<circle class="wr-term used" cx="82" cy="${y}" r="8"/><text class="wr-label" x="62" y="${y + 5}" text-anchor="end">${n}</text>`);
  });
  [[p2[0], 100], [p2[1], 160]].forEach(([n, y]) => {
    sv.push(`<circle class="wr-term used" cx="388" cy="${y}" r="8"/><text class="wr-label" x="408" y="${y + 5}">${n}</text>`);
  });
  sv.push('<rect class="wr-box pg-dev" x="150" y="52" width="170" height="156" rx="14"/>');
  sv.push(`<text class="wr-title" x="235" y="80" text-anchor="middle">${t(valve ? 'pg_dev_valve' : 'pg_dev_conv')}</text>`);
  sv.push(`<text class="wr-sub" x="235" y="196" text-anchor="middle">${i.wire === '2f' ? t('pg_pow_loop') : t('pg_pow_own')}</text>`);
  [[inLbl[0], 100], [inLbl[1], 160]].forEach(([n, y]) => {
    sv.push(`<circle class="wr-term used" cx="158" cy="${y}" r="7"/><text class="wr-label pg-in" x="172" y="${y + 5}">${n}</text>`);
  });
  [[outLbl[0], 100], [outLbl[1], 160]].forEach(([n, y]) => {
    sv.push(`<circle class="wr-term used" cx="312" cy="${y}" r="7"/><text class="wr-label pg-in" x="298" y="${y + 5}" text-anchor="end">${n}</text>`);
  });
  wires.forEach((w) => sv.push(`<path class="${w.cls}" d="${w.d}"/>`));
  wires.forEach((w) => sv.push(`<path class="wr-flow${w.cls === 'wr-com' ? ' com' : ''}" d="${w.d}"/>`));
  wires.forEach((w) => {
    sv.push(`<circle class="wr-badge ${w.cls}-b" cx="${w.at[0]}" cy="${w.at[1] - 17}" r="10"/>`);
    sv.push(`<text class="wr-badge-t" x="${w.at[0]}" y="${w.at[1] - 12.5}" text-anchor="middle">${w.n}</text>`);
  });
  // IT: margine per le etichette dei morsetti / EN: room for the terminal labels
  $('wiring').innerHTML = `<g transform="translate(22,0)">${sv.join('')}</g>`;
  $('wiring').classList.toggle('is-on', running);
  $('wire-list').innerHTML = wires.map((w) => `<li><span class="wl-n ${w.cls}-b">${w.n}</span><span>${w.txt}</span></li>`).join('');
  $('wr-note').textContent = t(valve ? 'pg_wr_valve' : i.wire === '2f' ? 'pg_wr_conv2f' : 'pg_wr_conv');
}

// ── Configurazione / Configuration ────────────────────────────────────────

/**
 * IT: Gruppo di pulsanti di scelta. EN: Choice button group.
 */
function seg(name, opts, value) {
  return `<div class="seg seg-wide" role="group">${opts.map(([v, l]) =>
    `<button type="button" data-${name}="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
}

/**
 * IT: Disegna il pannello di configurazione della prova scelta. EN: Draws the configuration panel of the chosen test.
 */
function renderCfg() {
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === cfg.mode)));
  const box = $('pg-cfg');
  if (cfg.mode === 'conv') {
    box.innerHTML = `
      <span class="label">${t('pg_stim')}</span>${seg('out', Object.entries(OUTS).map(([k, v]) => [k, v.label]), cfg.out)}
      <span class="label">${t('pg_resp')}</span>${seg('in', Object.entries(INS).map(([k, v]) => [k, v.label]), cfg.in).replace('seg seg-wide', 'seg seg-wide seg-2x2')}
      <div class="sc-grid">
        <label class="sc-f"><span class="k">${t('pg_tol')}</span><span class="field"><input id="pg-tol" type="text" inputmode="decimal" value="${fmt(cfg.tol, 2)}"><span class="unit">%</span></span></label>
        <label class="sc-f"><span class="k">${t('pg_settle')}</span><span class="field"><input id="pg-settle" type="text" inputmode="decimal" value="${fmt(cfg.settle, 1)}"><span class="unit">s</span></span></label>
      </div>
      <label class="check-opt"><input id="pg-down" type="checkbox"${cfg.down ? ' checked' : ''}> ${t('pg_down')}</label>`;
  } else {
    box.innerHTML = `
      <span class="label">${t('pg_cmd')}</span><div class="sc-fixed">4–20 mA · P1.3 mA+</div>
      <span class="label">${t('pg_fb')}</span>${seg('vin', [['i2', INS.i2.label], ['i4', INS.i4.label]], cfg.vin)}
      <span class="label">${t('pg_vstep')}</span>${seg('vstep', [[25, '25 %'], [10, '10 %']], cfg.vstep)}
      <div class="sc-grid">
        <label class="sc-f"><span class="k">${t('pg_tol')}</span><span class="field"><input id="pg-tol" type="text" inputmode="decimal" value="${fmt(cfg.tol, 2)}"><span class="unit">%</span></span></label>
        <label class="sc-f"><span class="k">${t('pg_vtimeout')}</span><span class="field"><input id="pg-vto" type="text" inputmode="decimal" value="${fmt(cfg.vtimeout, 0)}"><span class="unit">s</span></span></label>
      </div>`;
  }
  const n = (v) => { const x = Number(String(v).trim().replace(',', '.')); return Number.isFinite(x) ? x : null; };
  box.querySelectorAll('[data-out],[data-in],[data-vin],[data-vstep]').forEach((b) => b.addEventListener('click', () => {
    const k = Object.keys(b.dataset)[0];
    cfg[k] = k === 'vstep' ? Number(b.dataset[k]) : b.dataset[k];
    saveCfg();
    renderAll();
  }));
  if ($('pg-tol')) $('pg-tol').addEventListener('change', (e) => { const v = n(e.target.value); if (v !== null && v > 0) { cfg.tol = v; saveCfg(); } });
  if ($('pg-settle')) $('pg-settle').addEventListener('change', (e) => { const v = n(e.target.value); if (v !== null && v >= 0) { cfg.settle = v; saveCfg(); } });
  if ($('pg-vto')) $('pg-vto').addEventListener('change', (e) => { const v = n(e.target.value); if (v !== null && v >= 5) { cfg.vtimeout = v; saveCfg(); } });
  if ($('pg-down')) $('pg-down').addEventListener('change', (e) => { cfg.down = e.target.checked; saveCfg(); });
  box.querySelectorAll('input, button').forEach((el) => { el.disabled = running; });
}

// ── Misure / Measurements ─────────────────────────────────────────────────

/**
 * IT: Attende 12 conversioni nuove e restituisce lo stato (media mobile tutta nuova). EN: Waits for 12 new conversions and returns the state.
 */
async function freshState() {
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
 * IT: Imposta lo stimolo/comando a una percentuale del campo d'uscita. EN: Sets the stimulus/command at a percentage of the output range.
 */
async function setOut(o, pct) {
  const raw = o.lo + ((o.hi - o.lo) * pct) / 100;
  await request(`${o.api()}?value=${Math.round(raw * 10000) / 10000}${o.q}`, { method: 'POST' });
}

/**
 * IT: Percentuale del campo d'ingresso. EN: Percentage of the input range.
 */
function inPct(i, s) {
  return ((s.in[i.field] - i.lo) / (i.hi - i.lo)) * 100;
}

/**
 * IT: Avanzamento e passo in corso. EN: Progress and current step.
 */
function step(text, k, n) {
  $('pg-step').innerHTML = text ? `<span class="spinner"></span>${text}` : '';
  $('pg-bar').style.width = `${(k / n) * 100}%`;
}

/**
 * IT: Prova del convertitore: punti in salita (e discesa), errore in % del campo d'uscita del dispositivo.
 * EN: Converter test: ascending (and descending) points, error in % of the device output span.
 */
async function runConv() {
  const { o, i } = io();
  const pts = [0, 25, 50, 75, 100].concat(cfg.down ? [75, 50, 25, 0] : []);
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    step(t('pg_s_point', { p, k: k + 1, n: pts.length }), k, pts.length);
    await setOut(o, p);
    await sleep(cfg.settle * 1000);
    const s = await freshState();
    const read = s.in[i.field];
    const exp = i.lo + ((i.hi - i.lo) * p) / 100;
    // IT: al primo punto: risposta assente o fuori campo → collegamento o alimentazione del dispositivo
    // EN: at the first point: missing or out-of-range response → wiring or device supply
    if (k === 0 && Math.abs(read - exp) > (i.hi - i.lo) * 0.2) {
      throw new Error(t('pg_e_resp', { r: `${fmt(read, 3)} ${i.unit}`, x: `${fmt(exp, 3)} ${i.unit}` }));
    }
    const err = ((read - exp) / (i.hi - i.lo)) * 100;
    rows.push({ p, dir: k > 4 ? 'dn' : 'up', out: o.lo + ((o.hi - o.lo) * p) / 100, ou: o.unit, exp, read, iu: i.unit, err, ok: Math.abs(err) <= cfg.tol });
    renderResults();
  }
  step('', pts.length, pts.length);
  const errMax = Math.max(...rows.map((r) => Math.abs(r.err)));
  let hyst = 0;
  rows.filter((r) => r.dir === 'dn').forEach((d) => {
    const u = rows.find((r) => r.dir === 'up' && r.p === d.p);
    if (u) hyst = Math.max(hyst, Math.abs(u.err - d.err));
  });
  summary = { ok: rows.every((r) => r.ok), items: [[t('pg_r_errmax'), `${fmt(errMax, 3)} %`], [t('pg_r_hyst'), cfg.down ? `${fmt(hyst, 3)} %` : '–'], [t('pg_r_tol'), `±${fmt(cfg.tol, 2)} %`]] };
}

/**
 * IT: Un gradino della valvola: comando, campionamento ogni 300 ms fino a posizione stabile (2,5 s entro 0,2 %), t90.
 * EN: One valve step: command, sampling every 300 ms until the position is stable (2.5 s within 0.2 %), t90.
 */
async function valveStep(o, i, from, to, tStart) {
  await setOut(o, to);
  const t0 = Date.now();
  let t90 = null;
  const win = [];
  for (;;) {
    if (abort) throw new Error('abort');
    await sleep(300);
    const s = await request(API.state);
    lastState = s;
    const pos = inPct(i, s);
    const now = Date.now();
    trend.push({ t: (now - tStart) / 1000, cmd: to, pos });
    if (trend.length > 600) trend.shift();
    drawTrend();
    $('pg-live').textContent = t('pg_live', { c: fmt(to, 1), p: fmt(pos, 1) });
    if (t90 === null && Math.abs(to - from) > 0.5 && (to > from ? pos >= from + 0.9 * (to - from) : pos <= from + 0.9 * (to - from))) {
      t90 = (now - t0) / 1000;
    }
    win.push({ t: now, pos });
    while (win.length && now - win[0].t > 2500) win.shift();
    const span = Math.max(...win.map((w) => w.pos)) - Math.min(...win.map((w) => w.pos));
    if (now - t0 > 3000 && win.length >= 6 && span < 0.2) return { pos: win.reduce((a, w) => a + w.pos, 0) / win.length, t90, timeout: false };
    if (now - t0 > cfg.vtimeout * 1000) return { pos, t90, timeout: true };
  }
}

/**
 * IT: Prova della valvola: gradini su e giù, errore di posizione, isteresi, t90.
 * EN: Valve test: steps up and down, position error, hysteresis, t90.
 */
async function runValve() {
  const { o, i } = io();
  const up = [];
  for (let p = 0; p <= 100; p += cfg.vstep) up.push(p);
  const seq = up.concat(up.slice(0, -1).reverse());
  const tStart = Date.now();
  trend = [];
  step(t('pg_s_start'), 0, seq.length);
  let prev = 0;
  let r = await valveStep(o, i, 0, 0, tStart);
  if (Math.abs(r.pos) > 15) throw new Error(t('pg_e_fb', { p: fmt(r.pos, 1) }));
  for (let k = 1; k < seq.length; k++) {
    const p = seq[k];
    step(t('pg_s_vstep', { p, k, n: seq.length - 1 }), k, seq.length);
    r = await valveStep(o, i, prev, p, tStart);
    const err = r.pos - p;
    rows.push({ p, dir: k < up.length ? 'up' : 'dn', out: o.lo + ((o.hi - o.lo) * p) / 100, ou: o.unit, exp: p, read: r.pos, iu: '%', err, t90: r.t90, timeout: r.timeout, ok: Math.abs(err) <= cfg.tol && !r.timeout });
    renderResults();
    prev = p;
  }
  step('', seq.length, seq.length);
  const errMax = Math.max(...rows.map((x) => Math.abs(x.err)));
  let hyst = 0;
  rows.filter((x) => x.dir === 'dn').forEach((d) => {
    const u = rows.find((x) => x.dir === 'up' && x.p === d.p);
    if (u) hyst = Math.max(hyst, Math.abs(u.read - d.read));
  });
  const t90s = rows.map((x) => x.t90).filter((x) => x !== null);
  summary = {
    ok: rows.every((x) => x.ok),
    items: [[t('pg_r_errmax'), `${fmt(errMax, 2)} %`], [t('pg_r_hyst'), `${fmt(hyst, 2)} %`],
      [t('pg_r_t90'), t90s.length ? `${fmt(Math.max(...t90s), 1)} s` : '–'], [t('pg_r_tol'), `±${fmt(cfg.tol, 2)} %`]],
  };
}

/**
 * IT: Banda morta della valvola: da 50 % passi di 0,1 % ogni 3 s finché la posizione si muove di 0,25 %, in salita e in discesa.
 * EN: Valve dead band: from 50 % steps of 0.1 % every 3 s until the position moves by 0.25 %, up and down.
 */
async function runDeadband() {
  const { o, i } = io();
  const tStart = Date.now();
  trend = [];
  step(t('pg_s_db0'), 0, 3);
  const base = await valveStep(o, i, 0, 50, tStart);
  const one = async (dir, k) => {
    let c = 50;
    const p0 = inPct(i, await freshState());
    for (let n = 1; n <= 50; n++) {
      if (abort) throw new Error('abort');
      c = 50 + dir * 0.1 * n;
      step(t('pg_s_db', { c: fmt(c, 1) }), k, 3);
      await setOut(o, c);
      await sleep(3000);
      const s = await request(API.state);
      lastState = s;
      const pos = inPct(i, s);
      trend.push({ t: (Date.now() - tStart) / 1000, cmd: c, pos });
      drawTrend();
      if (Math.abs(pos - p0) >= 0.25) return Math.abs(c - 50);
    }
    return null;
  };
  const dbUp = await one(1, 1);
  await valveStep(o, i, 55, 50, tStart);
  const dbDn = await one(-1, 2);
  step('', 3, 3);
  summary = {
    ok: dbUp !== null && dbDn !== null,
    items: [[t('pg_r_db_up'), dbUp === null ? '> 5 %' : `${fmt(dbUp, 1)} %`], [t('pg_r_db_dn'), dbDn === null ? '> 5 %' : `${fmt(dbDn, 1)} %`],
      [t('pg_r_base'), `${fmt(base.pos, 2)} %`]],
  };
}

/**
 * IT: Esegue una prova: azzera i risultati, gestisce interruzione ed errori, spegne sempre le uscite.
 * EN: Runs a test: clears results, handles abort and errors, always switches outputs off.
 */
async function run(kind) {
  if (running) return;
  running = true;
  abort = false;
  rows = [];
  summary = null;
  renderAll();
  let err = '';
  try {
    if (kind === 'conv') await runConv();
    else if (kind === 'valve') await runValve();
    else await runDeadband();
  } catch (e) {
    err = e.message === 'abort' ? t('at_aborted') : e.message || t('cmd_fail');
  }
  try { await request(API.off, { method: 'POST' }); } catch (e) { /* IT/EN: spegnimento di sicurezza / safety switch-off */ }
  running = false;
  if (err) summary = { ok: false, err, items: summary ? summary.items : [] };
  summary.date = Date.now();
  summary.kind = kind;
  renderAll();
}

// ── Risultati / Results ───────────────────────────────────────────────────

/**
 * IT: Tabella dei punti. EN: Points table.
 */
function renderResults() {
  const valve = cfg.mode === 'valve';
  $('pg-table').hidden = rows.length === 0;
  $('pg-table').classList.toggle('valve', valve);
  $('pg-head').innerHTML = valve
    ? `<th>${t('pg_th_cmd')}</th><th>${t('pg_th_pos')}</th><th>${t('pg_th_err')}</th><th>t90</th>`
    : `<th>%</th><th>${t('pg_th_out')}</th><th>${t('pg_th_exp')}</th><th>${t('pg_th_read')}</th><th>${t('pg_th_err')}</th>`;
  $('pg-rows').innerHTML = rows.map((r) => {
    const arrow = r.dir === 'dn' ? '↓' : '↑';
    const dot = `<span class="dot ${r.ok ? 'ok' : 'err'}"></span>`;
    return valve
      ? `<tr class="${r.ok ? '' : 'ko'}"><td>${dot}${arrow} ${fmt(r.p, 0)} %</td><td>${fmt(r.read, 2)} %</td><td>${r.err >= 0 ? '+' : ''}${fmt(r.err, 2)} %</td><td>${r.timeout ? t('pg_timeout') : r.t90 === null ? '–' : `${fmt(r.t90, 1)} s`}</td></tr>`
      : `<tr class="${r.ok ? '' : 'ko'}"><td>${dot}${arrow} ${fmt(r.p, 0)}</td><td>${fmt(r.out, 3)} ${r.ou}</td><td>${fmt(r.exp, 3)}</td><td>${fmt(r.read, 3)} ${r.iu}</td><td>${r.err >= 0 ? '+' : ''}${fmt(r.err, 3)} %</td></tr>`;
  }).join('');
  drawErrors();
}

/**
 * IT: Grafico degli errori per punto (salita blu, discesa arancio) con la fascia di tolleranza.
 * EN: Error chart per point (ascending blue, descending orange) with the tolerance band.
 */
function drawErrors() {
  const svg = $('pg-chart');
  $('pg-chart-box').hidden = rows.length === 0;
  if (!rows.length) return;
  const W = 600;
  const H = 180;
  const L = 78;
  const R = 12;
  const lim = Math.max(cfg.tol * 1.5, ...rows.map((r) => Math.abs(r.err) * 1.2));
  const x = (p) => L + ((W - L - R) * p) / 100;
  const y = (e) => (H - 22) / 2 - (e / lim) * ((H - 22) / 2 - 12);
  const o = [];
  o.push(`<rect class="ch-band" x="${L}" y="${y(cfg.tol)}" width="${W - L - R}" height="${y(-cfg.tol) - y(cfg.tol)}"/>`);
  o.push(`<line class="ch-zero" x1="${L}" y1="${y(0)}" x2="${W - R}" y2="${y(0)}"/>`);
  [cfg.tol, -cfg.tol].forEach((e) => o.push(`<text class="ch-ax" x="${L - 6}" y="${y(e) + 4}" text-anchor="end">${e > 0 ? '+' : ''}${fmt(e, 2)}%</text>`));
  [0, 25, 50, 75, 100].forEach((p) => o.push(`<text class="ch-ax" x="${x(p)}" y="${H - 4}" text-anchor="${p === 100 ? 'end' : p === 0 ? 'start' : 'middle'}">${p}%</text>`));
  ['up', 'dn'].forEach((d) => {
    const pts = rows.filter((r) => r.dir === d);
    if (pts.length > 1) o.push(`<polyline class="ch-line ${d}" points="${pts.map((r) => `${x(r.p)},${y(r.err)}`).join(' ')}"/>`);
    pts.forEach((r) => o.push(`<circle class="ch-pt ${d}" cx="${x(r.p)}" cy="${y(r.err)}" r="7"/>`));
  });
  svg.innerHTML = o.join('');
}

/**
 * IT: Andamento della valvola: comando (tratteggio) e posizione nel tempo. EN: Valve trend: command (dashed) and position over time.
 */
function drawTrend() {
  const svg = $('pg-trend');
  $('pg-trend-box').hidden = trend.length < 2;
  if (trend.length < 2) return;
  const W = 600;
  const H = 160;
  const t1 = trend[trend.length - 1].t;
  const t0 = Math.max(0, t1 - 120);
  const pts = trend.filter((p) => p.t >= t0);
  const x = (tt) => ((tt - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v) => H - 8 - (Math.max(-5, Math.min(105, v)) / 100) * (H - 16);
  svg.innerHTML = `<polyline class="tr-cmd" points="${pts.map((p) => `${x(p.t)},${y(p.cmd)}`).join(' ')}"/>
    <polyline class="tr-pos" points="${pts.map((p) => `${x(p.t)},${y(p.pos)}`).join(' ')}"/>`;
}

/**
 * IT: Riepilogo dell'esito. EN: Outcome summary.
 */
function renderSummary() {
  const box = $('pg-sum');
  if (!summary) { box.hidden = true; return; }
  box.hidden = false;
  box.className = `at-sum ${summary.ok ? 'ok' : 'ko'}`;
  $('pg-sum-t').textContent = t(summary.ok ? 'pg_ok' : 'pg_ko');
  $('pg-sum-d').innerHTML = summary.items.map(([k, v]) => `<span>${k}: <b>${v}</b></span>`).join('');
  $('pg-sum-e').textContent = summary.err || '';
  $('pg-sum-e').hidden = !summary.err;
  $('pg-copy').hidden = rows.length === 0;
}

/**
 * IT: Copia dei risultati come testo tabellare (CSV con punto e virgola). EN: Results copy as tabular text (semicolon CSV).
 */
function copyResults() {
  const { o, i } = io();
  const lines = [`IO Tester;${t(cfg.mode === 'conv' ? 'pg_m_conv' : 'pg_m_valve')};${new Date(summary.date).toLocaleString(locale())}`,
    `${t('pg_stim')};${o.label};${t('pg_resp')};${i.label};${t('pg_r_tol')};${fmt(cfg.tol, 2)} %`,
    ...summary.items.map(([k, v]) => `${k};${v}`),
    `%;${t('pg_th_out')};${t('pg_th_exp')};${t('pg_th_read')};${t('pg_th_err')} %;t90 s`,
    ...rows.map((r) => [`${r.dir === 'dn' ? '↓' : '↑'}${fmt(r.p, 0)}`, fmt(r.out, 4), fmt(r.exp, 4), fmt(r.read, 4), fmt(r.err, 3), r.t90 == null ? '' : fmt(r.t90, 1)].join(';'))];
  const ta = $('pg-txt');
  ta.hidden = false;
  ta.value = lines.join('\n');
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  $('pg-copy-msg').textContent = t(ok ? 'up_copied' : 'up_copy_fail');
}

/**
 * IT: Aggiorna tutta la pagina. EN: Updates the whole page.
 */
function renderAll() {
  renderCfg();
  renderWiring();
  const valve = cfg.mode === 'valve';
  const ready = $('pg-chk').checked;
  $('pg-go').disabled = running || !ready;
  $('pg-go').textContent = t(valve ? 'pg_go_valve' : 'pg_go_conv');
  $('pg-db').hidden = !valve;
  $('pg-db').disabled = running || !ready;
  $('pg-stop').hidden = !running;
  $('pg-prog').hidden = !running;
  $('pg-live').hidden = !(running && valve);
  $('pg-chk').disabled = running;
  document.querySelectorAll('[data-mode]').forEach((b) => { b.disabled = running; });
  const chip = $('state');
  chip.className = `state-chip${running ? ' on' : ''}`;
  chip.dataset.i18n = running ? 'cal_st_run' : 'cal_st_idle';
  chip.textContent = t(chip.dataset.i18n);
  $('pg-info-conv').hidden = valve;
  $('pg-info-valve').hidden = !valve;
  renderResults();
  renderSummary();
  if (!valve) $('pg-trend-box').hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const onState = (s) => { lastState = s; renderBanner(s.out); $('fw').textContent = s.fw; };
  initChrome(() => renderAll(), onState);
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    cfg.mode = b.dataset.mode;
    saveCfg();
    rows = [];
    summary = null;
    trend = [];
    $('pg-chk').checked = false;
    renderAll();
  }));
  $('pg-chk').addEventListener('change', renderAll);
  $('pg-go').addEventListener('click', () => run(cfg.mode));
  $('pg-db').addEventListener('click', () => run('db'));
  $('pg-stop').addEventListener('click', () => { abort = true; });
  $('pg-copy').addEventListener('click', copyResults);
  renderAll();
  startPolling(onState);
});
