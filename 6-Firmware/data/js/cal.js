/*
  IO Tester — pagina "Calibrazione" / "Calibration" page
  IT: Stato della calibrazione dei 5 canali e procedure guidate:
      - ingressi (VIN, IIN): due punti con multimetro di riferimento; lo stimolo è l'uscita dello
        strumento in loopback oppure una sorgente esterna; si salva la retta reale = g × nominale + o;
      - uscite (VOUT, IOUT, SINK): procedura automatica del firmware in loopback contro gli ingressi
        calibrati (5 punti, minimi quadrati, verifica su 3 punti), seguita da /api/cal/status.
  EN: Calibration state of the 5 channels and guided procedures:
      - inputs (VIN, IIN): two points with a reference multimeter; the stimulus is the instrument
        output in loopback or an external source; the line real = g × nominal + o is saved;
      - outputs (VOUT, IOUT, SINK): automatic firmware procedure in loopback against the calibrated
        inputs (5 points, least squares, 3-point verification), followed via /api/cal/status.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

const CAL_API = {
  status: '/api/cal/status',
  output: '/api/cal/output',
  input: '/api/cal/input',
  clear: '/api/cal/clear',
};

// IT: Canali nell'ordine consigliato / EN: Channels in the recommended order
const CH = {
  vin: { kind: 'in', unit: 'V', name: 'ch_vin', terms: 'P2.2 V+ · P2.1 V−', pts: [1, 9], api: API.outV,
         nom: 'v_nom', sat: 'sat_v', stable: 0.0005, minSpan: 2, offMax: 0.2, sub: 'mV' },
  iin: { kind: 'in', unit: 'mA', name: 'ch_iin', terms: 'P2.4 mA+ · P2.3 mA−', pts: [4, 20], api: API.outI,
         nom: 'i_nom', sat: 'sat_i', stable: 0.001, minSpan: 4, offMax: 0.5, sub: 'µA' },
  vout: { kind: 'out', unit: 'V', name: 'ch_vout', terms: 'P1.4 V+ · P1.1 COM', needs: 'vin', sub: 'mV' },
  iout: { kind: 'out', unit: 'mA', name: 'ch_iout', terms: 'P1.3 mA+ · P1.1 COM', needs: 'iin', sub: 'µA' },
  sink: { kind: 'out', unit: 'mA', name: 'ch_sink', terms: 'P1.2 SIM+ · P1.1 COM', needs: 'iin', sub: 'µA' },
};
const ORDER = ['vin', 'iin', 'vout', 'iout', 'sink'];
const N_PTS = 5;
const N_VER = 3;
const GAIN_TOL = 0.05;

let lastState = null;
let sel = null;       // IT: canale scelto / EN: selected channel
let wz = null;        // IT: stato della procedura guidata / EN: wizard state
let calTimer = 0;

/**
 * IT: Numero dal campo di testo (virgola o punto); null se non valido. EN: Number from a text field (comma or dot); null if invalid.
 */
function parseNum(str) {
  const raw = String(str).trim().replace(',', '.');
  const v = Number(raw);
  return raw !== '' && Number.isFinite(v) ? v : null;
}

/**
 * IT: Offset in unità piccole con segno (mV o µA). EN: Signed offset in small units (mV or µA).
 */
function fmtOffset(c, o) {
  const v = o * 1000;
  return `${v >= 0 ? '+' : ''}${fmt(v, 1)} ${c.sub}`;
}

/**
 * IT: true se una procedura è in corso (lista bloccata). EN: true while a procedure is in progress (list locked).
 */
function busy() {
  return !!wz && !(wz.kind === 'in' && (wz.step === 0 || wz.step === 4)) && !(wz.kind === 'out' && wz.phase !== 'run');
}

// ── Disegno dei collegamenti / Wiring diagram ─────────────────────────────

const P1Y = { 'P1.1 COM': 80, 'P1.2 SIM+': 125, 'P1.3 mA+': 170, 'P1.4 V+': 215 };
const P2Y = { 'P2.1 V−': 60, 'P2.2 V+': 105, 'P2.3 mA−': 150, 'P2.4 mA+': 195, 'P2.5 L+': 240 };

// IT: Fili per canale (nessun incrocio) / EN: Wires per channel (no crossings)
const WIRING = {
  vin: {
    used: ['P1.1 COM', 'P1.4 V+', 'P2.1 V−', 'P2.2 V+'], pos: ['P1.4 V+', 'P2.2 V+'],
    wires: [['com', '149,80 200,80 200,60 451,60'], ['pos', '149,215 430,215 430,105 451,105']],
    dmm: { x: 240, y: 112, w: 140, h: 72, title: 'dmm_v', tx: 310, ty: 152,
           jacks: [[310, 112, 'COM', 310, 130], [310, 184, 'V', 310, 176]],
           wires: [['com', '310,112 310,60'], ['pos', '310,184 310,215']], junc: [[310, 60], [310, 215]] },
  },
  vout: {
    used: ['P1.1 COM', 'P1.4 V+', 'P2.1 V−', 'P2.2 V+'], pos: ['P1.4 V+', 'P2.2 V+'],
    wires: [['com', '149,80 200,80 200,60 451,60'], ['pos', '149,215 430,215 430,105 451,105']],
  },
  iin: {
    used: ['P1.1 COM', 'P1.3 mA+', 'P2.3 mA−', 'P2.4 mA+'], pos: ['P1.3 mA+', 'P2.4 mA+'],
    wires: [['com', '149,80 240,80 240,150 451,150'], ['pos', '149,170 200,170 200,206 270,206'],
            ['pos', '400,206 420,206 420,195 451,195']],
    dmm: { x: 270, y: 176, w: 130, h: 60, title: 'dmm_ma', tx: 335, ty: 205,
           jacks: [[270, 206, 'mA', 282, 228], [400, 206, 'COM', 388, 228]], wires: [], junc: [] },
  },
  iout: {
    used: ['P1.1 COM', 'P1.3 mA+', 'P2.3 mA−', 'P2.4 mA+'], pos: ['P1.3 mA+', 'P2.4 mA+'],
    wires: [['com', '149,80 240,80 240,150 451,150'], ['pos', '149,170 300,170 300,195 451,195']],
  },
  sink: {
    used: ['P1.1 COM', 'P1.2 SIM+', 'P2.4 mA+', 'P2.5 L+'], pos: ['P1.2 SIM+', 'P2.5 L+'],
    wires: [['com', '149,80 260,80 260,195 451,195'], ['pos', '149,125 220,125 220,240 451,240']],
  },
};

/**
 * IT: Disegna il collegamento del canale (P1 a sinistra, P2 a destra, multimetro se serve).
 * EN: Draws the channel wiring (P1 on the left, P2 on the right, multimeter when needed).
 */
function wiringSvg(id) {
  const w = WIRING[id];
  const o = [];
  o.push('<text class="wr-title" x="140" y="26" text-anchor="middle">P1 OUTPUT</text>');
  o.push('<rect class="wr-strip" x="128" y="56" width="24" height="182" rx="5"/>');
  o.push('<text class="wr-title" x="460" y="26" text-anchor="middle">P2 INPUT</text>');
  o.push('<rect class="wr-strip" x="448" y="40" width="24" height="222" rx="5"/>');
  const term = (name, x, y, lx, anchor) => {
    const used = w.used.includes(name);
    const cls = w.pos.includes(name) ? ' pos' : used ? '' : ' free';
    o.push(`<circle class="wr-term${used ? ' used' : ''}" cx="${x}" cy="${y}" r="8"/>`);
    o.push(`<text class="wr-label${cls}" x="${lx}" y="${y + 4}" text-anchor="${anchor}">${name}</text>`);
  };
  Object.entries(P1Y).forEach(([n, y]) => term(n, 140, y, 118, 'end'));
  Object.entries(P2Y).forEach(([n, y]) => term(n, 460, y, 482, 'start'));
  const wires = [...w.wires, ...(w.dmm ? w.dmm.wires : [])];
  wires.forEach(([k, pts]) => o.push(`<polyline class="wr-${k}" points="${pts}"/>`));
  wires.forEach(([k, pts]) => o.push(`<polyline class="wr-flow${k === 'com' ? ' com' : ''}" points="${pts}"/>`));
  if (w.dmm) {
    const d = w.dmm;
    o.push(`<rect class="wr-dmm" x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="10"/>`);
    o.push(`<text class="wr-sub" x="${d.tx}" y="${d.ty}" text-anchor="middle">${t(d.title)}</text>`);
    d.jacks.forEach(([x, y, label, lx, ly]) => {
      o.push(`<circle class="wr-term used" cx="${x}" cy="${y}" r="6"/>`);
      o.push(`<text class="wr-label" x="${lx}" y="${ly}" text-anchor="middle">${label}</text>`);
    });
    d.junc.forEach(([x, y]) => o.push(`<circle class="wr-junc" cx="${x}" cy="${y}" r="4"/>`));
  }
  return o.join('');
}

/**
 * IT: Aggiorna disegno e nota del collegamento per il canale scelto. EN: Updates wiring diagram and note for the selected channel.
 */
function renderWiring() {
  const svg = $('wiring');
  const id = sel || 'vin';
  svg.innerHTML = wiringSvg(id);
  svg.classList.toggle('is-on', busy());
  $('wr-ch').textContent = t(CH[id].name);
  $('wr-note').textContent = t(`wr_cal_${id}`);
}

// ── Elenco dei canali / Channel list ──────────────────────────────────────

/**
 * IT: Disegna l'elenco dei canali con stato, coefficienti e pulsanti. EN: Draws the channel list with state, coefficients and buttons.
 */
function renderList() {
  const s = lastState;
  const lock = busy();
  $('chan-list').innerHTML = ORDER.map((id, k) => {
    const c = CH[id];
    const cal = s ? s.cal[id] : null;
    const ok = cal && cal.valid;
    const status = !cal ? '–' : ok
      ? t('cal_yes_t', { d: fmtDate(cal.date), tc: cal.temp === null ? '–' : fmt(cal.temp, 1) })
      : t('v_none');
    const coef = ok ? `${t('k_gain')} ${fmt(cal.gain, 6)} · ${t('k_offset')} ${fmtOffset(c, cal.offset)}` : t(`cal_m_${c.kind}`);
    return `<div class="chan${sel === id ? ' sel' : ''}">
      <span class="chan-n">${k + 1}</span>
      <div class="chan-body">
        <div class="chan-top"><b>${t(c.name)}</b><span class="chan-terms">${c.terms}</span></div>
        <div class="chan-st"><span class="dot ${ok ? 'ok' : 'warn'}"></span>${status}</div>
        <div class="chan-coef${ok ? '' : ' m'}">${coef}</div>
      </div>
      <div class="chan-act">
        <button class="btn" type="button" data-cal="${id}"${lock ? ' disabled' : ''}>${t('btn_calibrate')}</button>
        ${ok ? `<button class="btn btn-ghost-danger" type="button" data-clear="${id}"${lock ? ' disabled' : ''}>${t('btn_clear')}</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Procedura guidata / Wizard ───────────────────────────────────────────

/**
 * IT: Sceglie un canale e apre la sua procedura dall'inizio. EN: Selects a channel and opens its procedure from the start.
 */
function selectChannel(id) {
  sel = id;
  wz = CH[id].kind === 'in'
    ? { kind: 'in', step: 0, ext: false, samples: [], points: [], res: null, err: '' }
    : { kind: 'out', phase: 'intro', st: null };
  renderAll();
  if (window.matchMedia('(max-width: 1023px)').matches) $('p-proc').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * IT: Chiude la procedura; spegne le uscite se lo strumento generava lo stimolo. EN: Closes the procedure; switches outputs off if the instrument was driving the stimulus.
 */
async function closeWizard(off) {
  if (off) await switchOff();
  sel = null;
  wz = null;
  renderAll();
}

/**
 * IT: Comanda l'uscita dello strumento allo stimolo del punto k (ingressi, se non c'è sorgente esterna).
 * EN: Drives the instrument output to the stimulus of point k (inputs, unless an external source is used).
 */
async function driveStimulus(k) {
  if (wz.ext) return true;
  try {
    await request(`${CH[sel].api}?value=${CH[sel].pts[k]}`, { method: 'POST' });
    return true;
  } catch (e) {
    setConn('cmd_fail', 'err');
    return false;
  }
}

/**
 * IT: Media e stabilità delle ultime 5 letture nominali. EN: Mean and stability of the last 5 nominal readings.
 */
function sampleInfo() {
  const a = wz.samples;
  if (!a.length) return { mean: null, stable: false };
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  const spread = Math.max(...a) - Math.min(...a);
  return { mean, stable: a.length >= 5 && spread <= CH[sel].stable };
}

/**
 * IT: Calcola guadagno e offset dai due punti e ne controlla la plausibilità (stessi limiti del firmware).
 * EN: Computes gain and offset from the two points and checks plausibility (same limits as the firmware).
 */
function computeInput() {
  const c = CH[sel];
  const [p1, p2] = wz.points;
  if (Math.abs(p2.r - p1.r) < c.minSpan || Math.abs(p2.m - p1.m) < c.minSpan) return { err: t('cal_e_span', { s: fmt(c.minSpan, 0), u: c.unit }) };
  const gain = (p2.r - p1.r) / (p2.m - p1.m);
  const offset = p1.r - gain * p1.m;
  if (Math.abs(gain - 1) > GAIN_TOL || Math.abs(offset) > c.offMax) return { gain, offset, err: t('cal_e_limits') };
  return { gain, offset, err: '' };
}

/**
 * IT: Conferma il punto in corso con la lettura media e il valore del multimetro. EN: Confirms the current point with the mean reading and the multimeter value.
 */
async function confirmPoint() {
  const c = CH[sel];
  const r = parseNum($('ref').value);
  const { mean, stable } = sampleInfo();
  if (r === null || mean === null || !stable) return;
  // IT: Il multimetro deve concordare con la lettura nominale entro il 5% + offset massimo (unità o collegamento sbagliati)
  // EN: The multimeter must agree with the nominal reading within 5% + max offset (wrong unit or wiring)
  if (Math.abs(r - mean) > 0.05 * Math.abs(mean) + c.offMax) {
    $('ref-err').textContent = t('cal_e_ref', { u: c.unit });
    $('ref-field').classList.add('err');
    return;
  }
  wz.points.push({ m: mean, r });
  if (wz.step === 1) {
    wz.step = 2;
    wz.samples = [];
    renderProc();
    await driveStimulus(1);
  } else {
    if (!wz.ext) await switchOff();
    wz.res = computeInput();
    wz.step = 3;
    renderProc();
  }
}

/**
 * IT: Salva la calibrazione dell'ingresso nel firmware (NVS). EN: Saves the input calibration in the firmware (NVS).
 */
async function saveInput() {
  const pin = await askPin('pin_for_cal');
  if (!pin) return;
  const [p1, p2] = wz.points;
  const q = `ch=${sel}&m1=${p1.m}&r1=${p1.r}&m2=${p2.m}&r2=${p2.r}&t=${Math.floor(Date.now() / 1000)}&pin=${encodeURIComponent(pin)}`;
  try {
    const res = await fetch(`${CAL_API.input}?${q}`, { method: 'POST', cache: 'no-store' });
    const j = await res.json();
    if (!j.ok) {
      wz.err = j.err === 'pin' || j.err === 'locked' ? pinErr(j) : j.err || t('cal_e_save');
      renderProc();
      return;
    }
    wz.step = 4;
    renderProc();
  } catch (e) {
    wz.err = t('cal_e_save');
    renderProc();
  }
}

/**
 * IT: Avvia la procedura automatica di un'uscita e ne segue lo stato. EN: Starts an output's automatic procedure and follows its state.
 */
async function startOutput() {
  const pin = await askPin('pin_for_cal');
  if (!pin) return;
  try {
    const res = await fetch(`${CAL_API.output}?ch=${sel}&t=${Math.floor(Date.now() / 1000)}&pin=${encodeURIComponent(pin)}`, { method: 'POST', cache: 'no-store' });
    if (!res.ok) throw new Error('409');
  } catch (e) {
    setConn('cmd_fail', 'err');
    return;
  }
  wz.phase = 'run';
  wz.st = null;
  renderAll();
  pollCal();
}

/**
 * IT: Legge /api/cal/status ogni secondo finché la procedura è in corso. EN: Reads /api/cal/status every second while the procedure runs.
 */
async function pollCal() {
  clearTimeout(calTimer);
  try {
    const st = await request(CAL_API.status);
    if (wz && wz.kind === 'out') {
      wz.st = st;
      if (!st.running && st.done) {
        wz.phase = 'done';
        renderAll();
        return;
      }
      renderProc();
    }
  } catch (e) { /* IT: riprova / EN: retry */ }
  if (wz && wz.kind === 'out' && wz.phase === 'run') calTimer = setTimeout(pollCal, 1000);
}

/**
 * IT: Tabella dei punti della procedura automatica (scarto in mV/µA). EN: Table of the automatic procedure points (deviation in mV/µA).
 */
function outTable(st, c) {
  const rows = [];
  (st ? st.pts : []).forEach((p, k) => {
    rows.push(`<tr><td>${t('cal_pt', { k: k + 1 })}</td><td>${fmt(p.th, 4)}</td><td>${fmt(p.meas, 4)}</td><td>${fmt((p.meas - p.th) * 1000, 1)} ${c.sub}</td></tr>`);
  });
  (st ? st.ver : []).forEach((p, k) => {
    const e = (p.meas - p.target) * 1000;
    rows.push(`<tr class="ver"><td>${t('cal_ver', { k: k + 1 })}</td><td>${fmt(p.target, 4)}</td><td>${fmt(p.meas, 4)}</td><td>${fmt(e, 1)} ${c.sub}</td></tr>`);
  });
  if (!rows.length) return '';
  return `<table class="cal-table"><thead><tr><th></th><th>${t('cal_th_set', { u: c.unit })}</th><th>${t('cal_th_meas', { u: c.unit })}</th><th>${t('cal_th_dev')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

/**
 * IT: Disegna il pannello della procedura secondo il passo. EN: Draws the procedure panel according to the step.
 */
function renderProc() {
  const box = $('proc');
  const head = $('proc-title');
  if (!sel) {
    head.textContent = t('cal_proc');
    box.innerHTML = `<p class="hint">${t('cal_pick')}</p>`;
    return;
  }
  const c = CH[sel];
  head.textContent = `${t('cal_proc')} · ${t(c.name)}`;
  const s = lastState;

  if (wz.kind === 'in') {
    const k = wz.step;
    if (k === 0) {
      box.innerHTML = `
        <p>${t(`cal_in_intro_${sel}`)}</p>
        <ul class="check">
          <li>${t('cal_chk_warm')}</li>
          <li>${t(`cal_chk_dmm_${sel}`)}</li>
          <li>${t('cal_chk_wiring')}</li>
        </ul>
        <p class="alert warn">${t('cal_dmm_warn')}</p>
        <label class="check-opt"><input id="dmm-ok" type="checkbox"> ${t('cal_dmm_ok')}</label>
        <label class="check-opt"><input id="ext" type="checkbox"${wz.ext ? ' checked' : ''}> ${t('cal_ext')}</label>
        <div class="actions"><button id="go" class="btn btn-lg btn-primary" type="button" disabled>${t('btn_start')}</button>
        <button id="cancel" class="btn btn-lg" type="button">${t('btn_cancel')}</button></div>`;
      $('ext').addEventListener('change', (e) => { wz.ext = e.target.checked; });
      // IT: si parte solo dopo aver confermato un multimetro adeguato / EN: start only after confirming an adequate multimeter
      $('dmm-ok').addEventListener('change', (e) => { $('go').disabled = !e.target.checked; });
      $('go').addEventListener('click', async () => {
        wz.step = 1;
        wz.samples = [];
        renderAll();
        await driveStimulus(0);
      });
      $('cancel').addEventListener('click', () => closeWizard(false));
      return;
    }
    if (k === 1 || k === 2) {
      const target = c.pts[k - 1];
      box.innerHTML = `
        <div class="steps"><span class="${k === 1 ? 'cur' : 'done'}">1</span><span class="${k === 2 ? 'cur' : ''}">2</span><span>✓</span></div>
        <h3>${t('cal_point_h', { k, v: fmt(target, 0), u: c.unit })}</h3>
        <p class="hint">${t(wz.ext ? 'cal_point_ext' : `cal_point_int_${sel}`, { v: fmt(target, 0), u: c.unit })}</p>
        <span class="label">${t('cal_live')}</span>
        <div class="live-row"><span id="live" class="live-val num">–</span><span class="unit">${c.unit}</span><span id="stab" class="zone"></span></div>
        <label class="label" for="ref">${t('cal_ref_label')}</label>
        <div id="ref-field" class="field"><input id="ref" type="text" inputmode="decimal" autocomplete="off" placeholder="${fmt(target, 4)}"><span class="unit">${c.unit}</span></div>
        <div id="ref-err" class="err-text"></div>
        <div class="actions"><button id="ok" class="btn btn-lg btn-primary" type="button" disabled>${t('btn_confirm_pt', { k })}</button>
        <button id="cancel" class="btn btn-lg" type="button">${t('btn_cancel')}</button></div>`;
      $('ref').addEventListener('input', () => { $('ref-err').textContent = ''; $('ref-field').classList.remove('err'); updateLive(); });
      $('ref').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmPoint(); });
      $('ok').addEventListener('click', confirmPoint);
      $('cancel').addEventListener('click', () => closeWizard(!wz.ext));
      updateLive();
      return;
    }
    if (k === 3) {
      const r = wz.res;
      const rows = wz.points.map((p, i) => `<tr><td>${t('cal_pt', { k: i + 1 })}</td><td>${fmt(p.m, 4)}</td><td>${fmt(p.r, 4)}</td><td>${fmt((p.r - p.m) * 1000, 1)} ${c.sub}</td></tr>`).join('');
      box.innerHTML = `
        <div class="steps"><span class="done">1</span><span class="done">2</span><span class="cur">✓</span></div>
        <table class="cal-table"><thead><tr><th></th><th>${t('cal_th_nom', { u: c.unit })}</th><th>${t('cal_th_ref', { u: c.unit })}</th><th>${t('cal_th_dev')}</th></tr></thead><tbody>${rows}</tbody></table>
        ${r.gain !== undefined ? `<div class="coef"><span>${t('k_gain')} <b>${fmt(r.gain, 6)}</b></span><span>${t('k_offset')} <b>${fmtOffset(c, r.offset)}</b></span></div>` : ''}
        ${r.err || wz.err ? `<p class="alert" role="alert">${r.err || wz.err}</p>` : `<p class="hint">${t('cal_save_hint')}</p>`}
        <div class="actions"><button id="save" class="btn btn-lg btn-primary" type="button"${r.err ? ' disabled' : ''}>${t('btn_save_cal')}</button>
        <button id="cancel" class="btn btn-lg" type="button">${t('btn_cancel')}</button></div>`;
      $('save').addEventListener('click', saveInput);
      $('cancel').addEventListener('click', () => closeWizard(false));
      return;
    }
    // k === 4
    box.innerHTML = `
      <p class="ok-msg">${t('cal_saved')}</p>
      <p class="hint">${t(sel === 'vin' ? 'cal_next_vin' : 'cal_next_iin')}</p>
      <div class="actions single"><button id="cancel" class="btn btn-lg" type="button">${t('btn_close')}</button></div>`;
    $('cancel').addEventListener('click', () => closeWizard(false));
    return;
  }

  // Uscite / Outputs
  const ref = s ? s.cal[c.needs] : null;
  if (wz.phase === 'intro') {
    const refOk = ref && ref.valid;
    box.innerHTML = `
      <p>${t(`cal_out_intro_${sel}`)}</p>
      <p class="${refOk ? 'hint' : 'alert warn'}">${refOk
        ? t('cal_ref_ok', { n: t(CH[c.needs].name), d: fmtDate(ref.date) })
        : t('cal_ref_missing', { n: t(CH[c.needs].name) })}</p>
      <ul class="check"><li>${t('cal_chk_warm')}</li><li>${t('cal_chk_wiring')}</li><li>${t('cal_chk_free')}</li></ul>
      <div class="actions"><button id="go" class="btn btn-lg btn-primary" type="button">${t('btn_start_auto')}</button>
      <button id="cancel" class="btn btn-lg" type="button">${t('btn_cancel')}</button></div>`;
    $('go').addEventListener('click', startOutput);
    $('cancel').addEventListener('click', () => closeWizard(false));
    return;
  }
  const st = wz.st;
  const n = st ? st.pts.length + st.ver.length : 0;
  if (wz.phase === 'run') {
    const what = !st ? '' : st.pts.length < N_PTS
      ? t('cal_run_pt', { k: Math.min(st.pts.length + 1, N_PTS), n: N_PTS })
      : t('cal_run_ver', { k: Math.min(st.ver.length + 1, N_VER), n: N_VER });
    box.innerHTML = `
      <div class="progress"><div class="progress-fill" style="width:${(n / (N_PTS + N_VER)) * 100}%"></div></div>
      <p class="run-step"><span class="spinner"></span>${what}</p>
      ${outTable(st, c)}
      <div class="actions single"><button id="stop" class="btn btn-lg btn-danger" type="button">${t('btn_abort')}</button></div>`;
    $('stop').addEventListener('click', () => switchOff());
    return;
  }
  // done
  const ok = st && st.ok;
  const maxErr = st && st.ver.length ? Math.max(...st.ver.map((p) => Math.abs(p.meas - p.target) * 1000)) : null;
  box.innerHTML = `
    <div class="progress"><div class="progress-fill${ok ? '' : ' err'}" style="width:${(n / (N_PTS + N_VER)) * 100}%"></div></div>
    ${ok
      ? `<p class="ok-msg">${t('cal_saved')}</p><div class="coef"><span>${t('k_gain')} <b>${fmt(st.cal.gain, 6)}</b></span><span>${t('k_offset')} <b>${fmtOffset(c, st.cal.offset)}</b></span>${maxErr !== null ? `<span>${t('cal_ver_max')} <b>${fmt(maxErr, 1)} ${c.sub}</b></span>` : ''}</div>`
      : `<p class="alert" role="alert">${st && st.code ? t(`cal_c_${st.code}`) : t('cal_e_save')}${st && st.msg ? `<br><small>${st.msg}</small>` : ''}</p>`}
    ${outTable(st, c)}
    <div class="actions"><button id="again" class="btn btn-lg" type="button">${t('btn_repeat')}</button>
    <button id="cancel" class="btn btn-lg btn-primary" type="button">${t('btn_close')}</button></div>`;
  $('again').addEventListener('click', () => selectChannel(sel));
  $('cancel').addEventListener('click', () => closeWizard(false));
}

/**
 * IT: Aggiorna lettura dal vivo, stabilità e pulsante di conferma (punti degli ingressi).
 * EN: Updates live reading, stability and confirm button (input points).
 */
function updateLive() {
  if (!wz || wz.kind !== 'in' || (wz.step !== 1 && wz.step !== 2) || !$('live')) return;
  const c = CH[sel];
  const sat = lastState && lastState.in[c.sat];
  const { mean, stable } = sampleInfo();
  $('live').textContent = sat ? '– – –' : mean === null ? '–' : fmt(mean, 4);
  const z = $('stab');
  z.textContent = sat ? t('ms_sat') : stable ? t('cal_stable') : t('cal_settling');
  z.className = `zone ${sat ? 'err' : stable ? 'ok' : 'warn'}`;
  $('ok').disabled = sat || !stable || parseNum($('ref').value) === null;
}

/**
 * IT: Aggiorna elenco, procedura e collegamento. EN: Updates list, procedure and wiring.
 */
function renderAll() {
  renderList();
  renderProc();
  renderWiring();
  const chip = $('state');
  const run = busy();
  chip.className = `state-chip${run ? ' on' : ''}`;
  chip.dataset.i18n = run ? 'cal_st_run' : 'cal_st_idle';
  chip.textContent = t(chip.dataset.i18n);
}

/**
 * IT: Nuovo stato da /api/state: campioni per la procedura, elenco, barra uscita attiva.
 * EN: New state from /api/state: samples for the procedure, list, active-output bar.
 */
function onState(s) {
  lastState = s;
  if (wz && wz.kind === 'in' && (wz.step === 1 || wz.step === 2)) {
    const c = CH[sel];
    if (!s.in[c.sat]) {
      wz.samples.push(s.in[c.nom]);
      if (wz.samples.length > 5) wz.samples.shift();
    }
    updateLive();
  }
  renderList();
  if (wz && wz.kind === 'out' && wz.phase === 'intro') renderProc();
  $('fw').textContent = s.fw;
  renderBanner(s.out);
}

document.addEventListener('DOMContentLoaded', () => {
  initChrome(() => {
    // IT: al cambio lingua si ridisegna tutto, tranne il campo del multimetro (si conserva il valore)
    // EN: on language change everything is redrawn, except the multimeter field (its value is kept)
    const keep = $('ref') ? $('ref').value : null;
    renderAll();
    if (keep !== null && $('ref')) { $('ref').value = keep; updateLive(); }
  }, onState);
  renderAll();

  $('chan-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.cal) selectChannel(b.dataset.cal);
    if (b.dataset.clear) {
      const id = b.dataset.clear;
      if (!window.confirm(t('cal_clear_confirm', { n: t(CH[id].name) }))) return;
      const pin = await askPin('pin_for_cal_clear');
      if (!pin) return;
      try {
        await request(`${CAL_API.clear}?ch=${id}&pin=${encodeURIComponent(pin)}`, { method: 'POST' });
      } catch (err) {
        setConn('cmd_fail', 'err');
      }
    }
  });

  // IT: Se una procedura automatica è già in corso (altra scheda), la si segue
  // EN: If an automatic procedure is already running (another tab), follow it
  request(CAL_API.status).then((st) => {
    if (st.running && CH[st.ch]) {
      sel = st.ch;
      wz = { kind: 'out', phase: 'run', st };
      renderAll();
      pollCal();
    }
  }).catch(() => {});

  startPolling(onState);
});
