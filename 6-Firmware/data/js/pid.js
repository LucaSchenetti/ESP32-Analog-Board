/*
  IO Tester — pagina "Simulatore di Processo" / "Process Simulator" page
  IT: Prova del PID del PLC con un processo simulato nel firmware (procsim), interfaccia pensata per il telefono:
      in alto PV grande, uscita del PLC e valvola con barre, grafico degli ultimi 2 minuti (storico del firmware);
      sotto le schede Disturbi (carico, oscillazione, rumore, deriva, guasti del sensore), Processo
      (preimpostazioni, modello, valvola), Collega (segnali e disegno dei fili verso il PLC), PID (parametri
      suggeriti SIMC per PID_Compact e istruzioni TIA Portal); barra AVVIA/FERMA fissa in basso con conferma
      di avvio. Configurazione, disturbi e scheda aperta salvati nel browser.
  EN: PLC PID test with a process simulated in the firmware (procsim), interface designed for phones: on top a
      large PV, PLC output and valve with bars, chart of the last 2 minutes (firmware history); below the tabs
      Disturbances (load, oscillation, noise, drift, sensor failures), Process (presets, model, valve), Wiring
      (signals and wire drawing towards the PLC), PID (SIMC suggested parameters for PID_Compact and TIA Portal
      instructions); START/STOP bar fixed at the bottom with start confirmation. Configuration, disturbances and
      open tab stored in the browser.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

const SIM = { state: '/api/sim/state', start: '/api/sim/start', stop: '/api/sim/stop', dist: '/api/sim/dist', fault: '/api/sim/fault' };
const KEY = 'iotester.pid';
const TAB_KEY = 'iotester.pid.tab';
const TREND_S = 120;

// IT: Preimpostazioni di processi tipici (icona, parametri) / EN: Presets of typical processes (icon, parameters)
const PRESETS = {
  flow: { ic: 'ic-flow', p: { model: 0, gain: 1, t1: 2, dead: 0.5, pv0: 0, stroke: 3, db: 0.3, eq: 0, noise: 0.5 } },
  press: { ic: 'ic-gauge', p: { model: 0, gain: 1, t1: 5, dead: 1, pv0: 0, stroke: 5, db: 0.5, eq: 0, noise: 0.2 } },
  temp: { ic: 'ic-thermo', p: { model: 1, gain: 1.2, t1: 60, t2: 15, dead: 10, pv0: 15, stroke: 10, db: 0.5, eq: 0, noise: 0.1 } },
  level: { ic: 'ic-tank', p: { model: 2, gain: 1, tfill: 120, outflow: 50, dead: 1, stroke: 5, db: 0.5, eq: 0, noise: 0.3 } },
};
// IT: Segnali: etichetta e morsetti / EN: Signals: label and terminals
const INS = [['0–10 V', 'P2.2 V+ · P2.1 V−'], ['4–20 mA', 'P2.4 mA+ · P2.3 mA−'], ['0–20 mA', 'P2.4 mA+ · P2.3 mA−']];
const OUTS = [['0–10 V', 'P1.4 V+ · P1.1 COM'], ['4–20 mA · 4F', 'P1.3 mA+ · P1.1 COM'], ['0–20 mA · 4F', 'P1.3 mA+ · P1.1 COM'], ['4–20 mA · 2F', 'P1.2 SIM+ · P1.1 COM']];

const cfg = { preset: 'flow', model: 0, gain: 1, t1: 2, t2: 3, dead: 0.5, tfill: 120, outflow: 50, pv0: 0, stroke: 3, db: 0.3, eq: 0, noise: 0.5, in: 1, out: 1 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* IT/EN: opzionale / optional */ }
const dist = { load: 0, amp: 0, period: 30, drift: 0 };
let fault = 0;
let running = false;
let seq = 0;
let trend = [];          // IT: [t, mv, valve, pv] / EN: [t, mv, valve, pv]
let pushTimer = 0;
let lastSim = null;
let tab = 'dist';
try { tab = localStorage.getItem(TAB_KEY) || 'dist'; } catch (e) { /* IT/EN: opzionale / optional */ }

/**
 * IT: Salva la configurazione nel browser. EN: Saves the configuration in the browser.
 */
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* IT/EN: opzionale / optional */ }
}

/**
 * IT: Numero da un campo (virgola o punto); null se non valido. EN: Number from a field (comma or dot); null if invalid.
 */
function num(v) {
  const raw = String(v).trim().replace(',', '.');
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n : null;
}

/**
 * IT: Parametri della configurazione come query string. EN: Configuration parameters as a query string.
 */
function cfgQuery() {
  return ['model', 'gain', 't1', 't2', 'dead', 'tfill', 'outflow', 'pv0', 'stroke', 'db', 'eq', 'noise', 'in', 'out']
    .map((k) => `${k}=${cfg[k]}`).join('&');
}

/**
 * IT: Con la simulazione attiva invia la configurazione (senza ripartire) dopo 400 ms. EN: With the simulation running sends the configuration (no restart) after 400 ms.
 */
function pushCfg() {
  save();
  renderPid();
  renderBarInfo();
  if (!running) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => request(`${SIM.start}?${cfgQuery()}`, { method: 'POST' }).catch(() => setConn('cmd_fail', 'err')), 400);
}

/**
 * IT: Invia i disturbi. EN: Sends the disturbances.
 */
function sendDist() {
  return request(`${SIM.dist}?load=${dist.load}&amp=${dist.amp}&period=${dist.period}&drift=${dist.drift}`, { method: 'POST' })
    .catch(() => setConn('cmd_fail', 'err'));
}

/**
 * IT: Gruppo di scelte. EN: Choice group.
 */
function seg(name, opts, value, cls = '') {
  return `<div class="seg seg-wide ${cls}" role="group">${opts.map(([v, l]) =>
    `<button type="button" data-${name}="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
}

/**
 * IT: Campo numerico con unità. EN: Numeric field with unit.
 */
function field(attr, k, label, unit, value, dec) {
  return `<label class="sc-f"><span class="k">${t(label)}</span><span class="field"><input ${attr}="${k}" type="text" inputmode="decimal" autocomplete="off" value="${fmt(value, dec)}"><span class="unit">${unit}</span></span></label>`;
}

/**
 * IT: Nome breve del processo per barra e conferma. EN: Short process name for bar and confirmation.
 */
function procName() {
  return cfg.preset && PRESETS[cfg.preset] ? t(`pd_pre_${cfg.preset}`) : t(['pd_m_first', 'pd_m_second', 'pd_m_integ'][cfg.model]);
}

// ── Scheda Disturbi / Disturbances tab ────────────────────────────────────

/**
 * IT: Disturbo di carico a pulsanti grandi, oscillazione, rumore e deriva, guasti del sensore a tessere.
 * EN: Load disturbance with large buttons, oscillation, noise and drift, sensor failures as tiles.
 */
function renderDist() {
  const faults = [['ic-check', 0], ['ic-link', 1], ['ic-out', 2], ['ic-in', 3], ['ic-stop', 4]];
  $('pd-dist').innerHTML = `
    <div class="pd-sec"><span class="pd-st">${t('pd_load')}</span><span class="pd-sv">${dist.load > 0 ? '+' : ''}${fmt(dist.load, 0)} %</span></div>
    <div class="pd-load">${[-20, -10, 0, 10, 20].map((v) =>
      `<button class="pd-lbtn${dist.load === v ? ' sel' : ''}" type="button" data-load="${v}">${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</button>`).join('')}</div>
    <div class="pd-sec"><span class="pd-st">${t('pd_osc')}</span></div>
    <div class="sc-grid">${field('data-d', 'amp', 'pd_amp', '%', dist.amp, 1)}${field('data-d', 'period', 'pd_period', 's', dist.period, 0)}</div>
    <div class="pd-sec"><span class="pd-st">${t('pd_sensor')}</span></div>
    <div class="sc-grid">${field('data-n', 'noise', 'pd_noise', '%', cfg.noise, 2)}${field('data-d', 'drift', 'pd_drift', '%/min', dist.drift, 2)}</div>
    <div class="pd-sec"><span class="pd-st">${t('pd_fault')}</span></div>
    <div class="pd-faults">${faults.map(([ic, f]) =>
      `<button class="pd-ftile${fault === f ? ' sel' : ''}${f === 0 ? ' ok' : ''}" type="button" data-fault="${f}"><svg class="icon"><use href="img/icons.svg#${ic}"/></svg><span>${t(`pd_f${f}`)}</span></button>`).join('')}</div>
    <p class="hint">${t(cfg.out === 0 ? 'pd_fault_hint_v' : 'pd_fault_hint_i')}</p>`;
  $('pd-dist').querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => {
    dist.load = Number(b.dataset.load);
    sendDist();
    renderDist();
  }));
  $('pd-dist').querySelectorAll('[data-d]').forEach((i) => i.addEventListener('change', () => {
    const v = num(i.value);
    if (v === null) return;
    dist[i.dataset.d] = v;
    sendDist();
  }));
  $('pd-dist').querySelector('[data-n]').addEventListener('change', (e) => {
    const v = num(e.target.value);
    if (v === null || v < 0) return;
    cfg.noise = v;
    pushCfg();
  });
  $('pd-dist').querySelectorAll('[data-fault]').forEach((b) => b.addEventListener('click', () => {
    fault = Number(b.dataset.fault);
    request(`${SIM.fault}?f=${fault}`, { method: 'POST' }).catch(() => setConn('cmd_fail', 'err'));
    renderDist();
  }));
}

// ── Scheda Processo / Process tab ─────────────────────────────────────────

/**
 * IT: Preimpostazioni a tessere con icona, modello, parametri e valvola. EN: Preset tiles with icon, model, parameters and valve.
 */
function renderProc() {
  const m = cfg.model;
  const f = (k, l, u, d) => field('data-f', k, l, u, cfg[k], d);
  const params = m === 2
    ? [f('gain', 'pd_gain', '', 2), f('tfill', 'pd_tfill', 's', 0), f('outflow', 'pd_outflow', '%', 0), f('dead', 'pd_dead', 's', 1)]
    : [f('gain', 'pd_gain', '', 2), f('t1', 'pd_t1', 's', 1), ...(m === 1 ? [f('t2', 'pd_t2', 's', 1)] : []), f('dead', 'pd_dead', 's', 1), f('pv0', 'pd_pv0', '%', 0)];
  $('pd-proc').innerHTML = `
    <div class="pd-sec"><span class="pd-st">${t('pd_presets')}</span></div>
    <div class="pd-presets">${Object.entries(PRESETS).map(([k, p]) =>
      `<button class="pd-ptile${cfg.preset === k ? ' sel' : ''}" type="button" data-pre="${k}"><svg class="icon"><use href="img/icons.svg#${p.ic}"/></svg><b>${t(`pd_pre_${k}`)}</b><small>${t(`pd_pre_${k}_s`)}</small></button>`).join('')}</div>
    <div class="pd-sec"><span class="pd-st">${t('pd_model')}</span></div>
    ${seg('model', [[0, t('pd_m_first_s')], [1, t('pd_m_second_s')], [2, t('pd_m_integ_s')]], m)}
    <p class="hint">${t(`pd_m_hint_${m}`)}</p>
    <div class="sc-grid">${params.join('')}</div>
    <div class="pd-sec"><span class="pd-st">${t('pd_valve')}</span></div>
    <div class="sc-grid">${f('stroke', 'pd_stroke', 's', 1)}${f('db', 'pd_db', '%', 1)}</div>
    ${seg('eq', [[0, t('pd_lin')], [1, t('pd_eqp')]], cfg.eq)}`;
  $('pd-proc').querySelectorAll('[data-pre]').forEach((b) => b.addEventListener('click', () => {
    Object.assign(cfg, PRESETS[b.dataset.pre].p, { preset: b.dataset.pre });
    renderProc();
    pushCfg();
  }));
  $('pd-proc').querySelectorAll('[data-model],[data-eq]').forEach((b) => b.addEventListener('click', () => {
    const k = Object.keys(b.dataset)[0];
    cfg[k] = Number(b.dataset[k]);
    cfg.preset = 'custom';
    renderProc();
    pushCfg();
  }));
  $('pd-proc').querySelectorAll('[data-f]').forEach((i) => i.addEventListener('change', () => {
    const v = num(i.value);
    if (v === null) return;
    cfg[i.dataset.f] = v;
    cfg.preset = 'custom';
    $('pd-proc').querySelectorAll('[data-pre]').forEach((b) => b.classList.remove('sel'));
    pushCfg();
  }));
}

// ── Scheda Collega / Wiring tab ───────────────────────────────────────────

/**
 * IT: Scelta dei segnali con i morsetti scritti sotto. EN: Signal choice with the terminals written below.
 */
function renderSig() {
  const opt = (name, list, val, cls) => `<div class="pd-sopts ${cls}">${list.map(([l, p], k) =>
    `<button type="button" class="pd-sopt${val === k ? ' sel' : ''}" data-${name}="${k}"><b>${l}</b><small>${p}</small></button>`).join('')}</div>`;
  $('pd-sig').innerHTML = `
    <div class="pd-sec"><span class="pd-st">${t('pd_out')}</span></div>
    ${opt('out', OUTS, cfg.out, 'four')}
    <div class="pd-sec"><span class="pd-st">${t('pd_in')}</span></div>
    ${opt('in', INS, cfg.in, 'three')}`;
  $('pd-sig').querySelectorAll('[data-in],[data-out]').forEach((b) => b.addEventListener('click', () => {
    if (running) return;   // IT: i segnali si cambiano a simulazione ferma / EN: signals are changed with the simulation stopped
    const k = Object.keys(b.dataset)[0];
    cfg[k] = Number(b.dataset[k]);
    renderSig();
    renderWiring();
    renderDist();
    pushCfg();
  }));
  $('pd-sig').classList.toggle('locked', running);
}

/**
 * IT: Disegno: IO Tester a sinistra (P1 sensore verso AI, P2 dall'AO), PLC a destra; fili diritti numerati.
 * EN: Drawing: IO Tester on the left (P1 sensor to AI, P2 from AO), PLC on the right; straight numbered wires.
 */
function renderWiring() {
  const sink = cfg.out === 3;
  const p1 = cfg.out === 0 ? 'P1.4 V+' : sink ? 'P1.2 SIM+' : 'P1.3 mA+';
  const p2 = cfg.in === 0 ? ['P2.2 V+', 'P2.1 V−'] : ['P2.4 mA+', 'P2.3 mA−'];
  const ai = sink ? ['AI + (L+)', 'AI −'] : ['AI +', 'AI −'];
  const wires = [
    { n: 1, cls: 'wr-pos', y: 80, txt: sink ? `${ai[0]} → ${p1}` : `${p1} → ${ai[0]}` },
    { n: 2, cls: 'wr-com', y: 130, txt: `P1.1 COM → ${ai[1]}` },
    { n: 3, cls: 'wr-cur', y: 210, txt: `AO + → ${p2[0]}` },
    { n: 4, cls: 'wr-com', y: 260, txt: `AO − → ${p2[1]}` },
  ];
  const o = [];
  o.push(`<text class="wr-title" x="122" y="30" text-anchor="middle">IO Tester</text>`);
  o.push('<rect class="wr-strip" x="110" y="58" width="24" height="94" rx="5"/><rect class="wr-strip" x="110" y="188" width="24" height="94" rx="5"/>');
  [[p1, 80], ['P1.1 COM', 130], [p2[0], 210], [p2[1], 260]].forEach(([n, y]) => {
    o.push(`<circle class="wr-term used" cx="122" cy="${y}" r="8"/><text class="wr-label" x="100" y="${y + 5}" text-anchor="end">${n}</text>`);
  });
  o.push('<rect class="wr-box pd-plc" x="330" y="40" width="160" height="250" rx="14"/>');
  o.push(`<text class="wr-title" x="410" y="30" text-anchor="middle">PLC</text>`);
  o.push('<rect class="wr-strip" x="344" y="58" width="24" height="94" rx="5"/><rect class="wr-strip" x="344" y="188" width="24" height="94" rx="5"/>');
  [[ai[0], 80], [ai[1], 130], ['AO +', 210], ['AO −', 260]].forEach(([n, y]) => {
    o.push(`<circle class="wr-term used" cx="356" cy="${y}" r="8"/><text class="wr-label" x="376" y="${y + 5}">${n}</text>`);
  });
  o.push(`<text class="wr-sub" x="378" y="166">${t('pd_wr_ai')}</text><text class="wr-sub" x="378" y="296">${t('pd_wr_ao')}</text>`);
  o.push(`<text class="pd-flow-t" x="239" y="64" text-anchor="middle">${t('pd_wr_pv')} →</text>`);
  o.push(`<text class="pd-flow-t" x="239" y="194" text-anchor="middle">← ${t('pd_wr_mv')}</text>`);
  wires.forEach((w) => o.push(`<path class="${w.cls}" d="M131,${w.y} H347"/>`));
  wires.forEach((w) => o.push(`<path class="wr-flow${w.cls === 'wr-com' ? ' com' : ''}" d="${w.y < 150 ? `M131,${w.y} H347` : `M347,${w.y} H131`}"/>`));
  wires.forEach((w) => {
    o.push(`<circle class="wr-badge ${w.cls}-b" cx="239" cy="${w.y}" r="11"/><text class="wr-badge-t" x="239" y="${w.y + 4.5}" text-anchor="middle">${w.n}</text>`);
  });
  $('wiring').innerHTML = `<g transform="translate(20,0)">${o.join('')}</g>`;
  $('wiring').classList.toggle('is-on', running);
  $('wire-list').innerHTML = wires.map((w) => `<li><span class="wl-n ${w.cls}-b">${w.n}</span><span>${w.txt}</span></li>`).join('');
  $('wr-note').textContent = t(sink ? 'pd_wr_note_sink' : 'pd_wr_note');
}

// ── Scheda PID / PID tab ──────────────────────────────────────────────────

/**
 * IT: Parametri PI/PID di partenza (regole SIMC, τc = tempo morto efficace; secondo ordine convertito per PID_Compact).
 * EN: Starting PI/PID parameters (SIMC rules, τc = effective dead time; second order converted for PID_Compact).
 */
function renderPid() {
  const theta = Math.max(cfg.dead + cfg.stroke * 0.1, 0.3);
  const tc = theta;
  let kc;
  let ti;
  let td = 0;
  if (cfg.model === 2) {
    const k = cfg.gain / Math.max(cfg.tfill, 1);
    kc = 1 / (k * (tc + theta));
    ti = 4 * (tc + theta);
  } else {
    kc = cfg.t1 / (cfg.gain * (tc + theta));
    ti = Math.min(cfg.t1, 4 * (tc + theta));
    if (cfg.model === 1) {
      td = cfg.t2;
      const f = 1 + td / ti;   // IT: da serie a parallela / EN: series to parallel
      kc *= f;
      const ti2 = ti + td;
      td = (ti * td) / ti2;
      ti = ti2;
    }
  }
  const cyc = Math.max(0.1, Math.min(theta, cfg.model === 2 ? 1 : cfg.t1) / 10);
  $('pd-pid').innerHTML = `
    <div class="pd-pid">
      <div class="pd-pcard"><span class="k">${t('pd_kc')}</span><span class="v">${fmt(kc, 2)}</span></div>
      <div class="pd-pcard"><span class="k">${t('pd_ti')}</span><span class="v">${fmt(ti, 1)}<small> s</small></span></div>
      <div class="pd-pcard"><span class="k">${t('pd_td')}</span><span class="v">${td ? fmt(td, 1) : '0'}<small> s</small></span></div>
      <div class="pd-pcard"><span class="k">${t('pd_cycle')}</span><span class="v">≤ ${fmt(cyc, 1)}<small> s</small></span></div>
    </div>
    <p class="hint">${t('pd_pid_hint')}</p>`;
}

// ── Valori, grafico e barra / Values, chart and bar ───────────────────────

/**
 * IT: Grafico degli ultimi 2 minuti: MV (tratteggio), valvola, PV misurata. EN: Chart of the last 2 minutes: MV (dashed), valve, measured PV.
 */
function drawTrend() {
  const W = 600;
  const H = 200;
  const t1 = trend.length ? trend[trend.length - 1][0] : 0;
  const t0 = Math.max(0, t1 - TREND_S);
  const pts = trend.filter((p) => p[0] >= t0);
  const x = (tt) => ((tt - t0) / TREND_S) * W;
  const y = (v) => H - 6 - (Math.max(-5, Math.min(105, v)) / 100) * (H - 12);
  const line = (k) => pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  $('pd-trend').innerHTML = `${[25, 50, 75].map((g) => `<line class="pd-grid" x1="0" y1="${y(g)}" x2="${W}" y2="${y(g)}"/>`).join('')}
    <polyline class="pd-mvl" points="${line(1)}"/><polyline class="pd-vll" points="${line(2)}"/><polyline class="pd-pvl" points="${line(3)}"/>`;
  $('pd-idle').hidden = trend.length > 1;
}

/**
 * IT: Testo della barra in basso: processo e segnali, oppure tempo di simulazione. EN: Bottom bar text: process and signals, or simulation time.
 */
function renderBarInfo() {
  const s = lastSim;
  $('pd-act-t').textContent = running ? t('pd_st_run') : procName();
  $('pd-act-s').textContent = running && s ? `${fmtDuration(Math.floor(s.t))} · ${procName()}` : `${OUTS[cfg.out][0]} → PLC → ${INS[cfg.in][0]}`;
}

/**
 * IT: Valori grandi, barre, avvisi, stato, pulsanti. EN: Large values, bars, warnings, state, buttons.
 */
function renderLive(s) {
  const on = !!(s && s.running);
  const inU = cfg.in === 0 ? 'V' : 'mA';
  const outU = cfg.out === 0 ? 'V' : 'mA';
  const pct = (v) => `${Math.max(0, Math.min(100, v))}%`;
  $('pd-pv').textContent = on ? fmt(s.pv_meas, 1) : '–';
  $('pd-pv-s').textContent = on ? `${fmt(s.out_sig, 3)} ${outU}` : ' ';
  $('pd-mv').textContent = on ? fmt(s.mv, 1) : '–';
  $('pd-mv-s').textContent = on ? `${fmt(s.mv_sig, 3)} ${inU}` : ' ';
  $('pd-vl').textContent = on ? fmt(s.valve, 1) : '–';
  $('pd-mv-b').style.width = on ? pct(s.mv) : '0';
  $('pd-vl-b').style.width = on ? pct(s.valve) : '0';
  $('pd-mvbad').hidden = !(on && s.mv_bad);
  $('pd-faulton').hidden = !(on && s.fault);
  $('pd-faulton').textContent = on && s.fault ? t('pd_fault_on', { f: t(`pd_f${s.fault}`) }) : '';
  // IT: FAULT reale dell'AD5412 (uscita in corrente, loop verso l'AI aperto): unico caso in rosso
  // EN: real AD5412 FAULT (current output, loop towards the AI open): the only red case
  $('pd-dacfault').hidden = !(on && s.dac_fault && (cfg.out === 1 || cfg.out === 2) && s.fault !== 1);
  const chip = $('state');
  chip.className = `state-chip${running ? ' on' : ''}`;
  chip.dataset.i18n = running ? 'pd_st_run' : 'pd_st_stop';
  chip.textContent = t(chip.dataset.i18n);
  $('pd-go').hidden = running;
  $('pd-stop').hidden = !running;
  $('p-live').classList.toggle('is-on', running);
  $('wiring').classList.toggle('is-on', running);
  renderBarInfo();
}

/**
 * IT: Lettura dello stato e dei nuovi campioni ogni 400 ms. EN: State and new samples read every 400 ms.
 */
async function poll() {
  try {
    const s = await request(`${SIM.state}?since=${seq}`);
    lastSim = s;
    if (s.running !== running) {
      running = s.running;
      renderSig();
    }
    if (s.hist.length) {
      if (trend.length && s.hist[0][0] < trend[trend.length - 1][0]) trend = [];   // IT: ripartita / EN: restarted
      trend.push(...s.hist);
      if (trend.length > 800) trend.splice(0, trend.length - 800);
      seq = s.seq;
      drawTrend();
    }
    renderLive(s);
  } catch (e) { /* IT: riprova / EN: retry */ }
  setTimeout(poll, 400);
}

// ── Schede e avvio / Tabs and start ───────────────────────────────────────

/**
 * IT: Mostra la scheda scelta. EN: Shows the chosen tab.
 */
function showTab(name) {
  tab = name;
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* IT/EN: opzionale / optional */ }
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  ['dist', 'proc', 'wire', 'pid'].forEach((n) => { $(`tab-${n}`).hidden = n !== name; });
}

/**
 * IT: Conferma di avvio in un pannello dal basso: processo, segnali, morsetti; poi avvia.
 * EN: Start confirmation in a bottom sheet: process, signals, terminals; then starts.
 */
function confirmStart() {
  const box = document.createElement('div');
  box.className = 'modal sheet';
  box.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <h3><svg class="icon"><use href="img/icons.svg#ic-play"/></svg>${t('pd_cf_t')}</h3>
      <dl class="pd-cf">
        <div><dt>${t('pd_cf_proc')}</dt><dd>${procName()}</dd></div>
        <div><dt>${t('pd_cf_out')}</dt><dd>${OUTS[cfg.out][0]}<small>${OUTS[cfg.out][1]}</small></dd></div>
        <div><dt>${t('pd_cf_in')}</dt><dd>${INS[cfg.in][0]}<small>${INS[cfg.in][1]}</small></dd></div>
      </dl>
      <p class="hint">${t('pd_cf_hint')}</p>
      <div class="actions"><button id="cf-ok" class="btn btn-lg btn-primary" type="button">${t('pd_go_s')}</button>
      <button id="cf-wire" class="btn btn-lg" type="button">${t('pd_cf_wire')}</button></div>
    </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  box.querySelector('#cf-wire').addEventListener('click', () => { close(); showTab('wire'); $('tab-wire').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  box.querySelector('#cf-ok').addEventListener('click', async () => {
    close();
    trend = [];
    seq = 0;
    fault = 0;
    drawTrend();
    try {
      await sendDist();
      await request(`${SIM.start}?reset=1&${cfgQuery()}`, { method: 'POST' });
      running = true;
      renderSig();
      renderDist();
      renderLive(lastSim);
    } catch (e) { setConn('cmd_fail', 'err'); }
  });
}

/**
 * IT: Ridisegna tutte le schede. EN: Redraws every tab.
 */
function renderAll() {
  renderDist();
  renderProc();
  renderSig();
  renderWiring();
  renderPid();
  renderLive(lastSim);
  drawTrend();
}

document.addEventListener('DOMContentLoaded', async () => {
  const onState = (s) => { $('fw').textContent = s.fw; };
  initChrome(() => renderAll(), onState);
  // IT: simulazione già attiva: si riprendono configurazione e disturbi del firmware
  // EN: simulation already running: firmware configuration and disturbances are taken over
  try {
    const s = await request(SIM.state);
    if (s.running) {
      running = true;
      Object.assign(cfg, s.cfg, { eq: s.cfg.eq ? 1 : 0 });
      Object.assign(dist, s.dist);
      fault = s.fault;
    }
  } catch (e) { /* IT/EN: nessuna risposta / no reply */ }
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('pd-go').addEventListener('click', confirmStart);
  $('pd-stop').addEventListener('click', async () => {
    try { await request(SIM.stop, { method: 'POST' }); } catch (e) { setConn('cmd_fail', 'err'); }
    running = false;
    renderSig();
    renderLive(lastSim);
  });
  $('pd-reset').addEventListener('click', async () => {
    trend = [];
    seq = 0;
    drawTrend();
    if (running) await request(`${SIM.start}?reset=1&${cfgQuery()}`, { method: 'POST' }).catch(() => setConn('cmd_fail', 'err'));
  });
  showTab(tab);
  renderAll();
  startPolling(onState);
  poll();
});
