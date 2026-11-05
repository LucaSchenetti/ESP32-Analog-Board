/*
  IO Tester — logica comune delle pagine di misura / shared logic of the measurement pages
  IT: Usata da "Misura tensione", "Corrente 4 fili" e "Corrente 2 fili": valore grande, barra del campo,
      stato (in misura, nessun segnale, fuori scala, negativa), HOLD, statistiche della sessione,
      andamento degli ultimi 2 minuti, dettagli tecnici dell'ADS1220 e confronto con l'uscita attiva.
      Ogni pagina passa solo la sua configurazione.
  EN: Used by "Measure voltage", "Current 4-wire" and "Current 2-wire": large value, range bar,
      state (measuring, no signal, over-range, negative), HOLD, session statistics, trend of the
      last 2 minutes, ADS1220 technical details and comparison with the active output.
      Each page only passes its configuration.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

const TREND_POINTS = 120;   // IT: 120 punti a 1 s = 2 minuti / EN: 120 points at 1 s = 2 minutes

/**
 * IT: Avvia una pagina di misura. cfg = { keys: { val, min, max, nom, code, sat }, unit, dec, lo, hi, ticks,
 *     calKey, noSignal, namur, cmp: { port, unit, scale, ok, warn, match(out) }, ranges: [{ id, label, lo, hi, namur }],
 *     scaleKey }; keys = nomi dei campi in /api/state.in; ranges = campi del segnale per la scalatura (scale.js).
 * EN: Starts a measurement page. cfg = { keys: { val, min, max, nom, code, sat }, unit, dec, lo, hi, ticks,
 *     calKey, noSignal, namur, cmp: { port, unit, scale, ok, warn, match(out) }, ranges: [{ id, label, lo, hi, namur }],
 *     scaleKey }; keys = field names in /api/state.in; ranges = signal ranges for scaling (scale.js).
 */
function initMeasurePage(cfg) {
  const K = cfg.keys;
  let lastState = null;
  let held = false;
  let stats = null;
  const trend = [];
  let scale = null;     // IT: pannello di scalatura / EN: scaling panel
  let alarm = null;     // IT: soglie e allarme / EN: thresholds and alarm
  let alarmUnit = null; // IT: unità mostrata nelle soglie / EN: unit shown in the thresholds

  /**
   * IT: Azzera le statistiche della sessione (algoritmo di Welford). EN: Resets the session statistics (Welford).
   */
  function resetStats() {
    stats = { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity, t0: Date.now() };
    trend.length = 0;
  }

  /**
   * IT: Aggiunge un valore a statistiche e andamento. EN: Adds a value to statistics and trend.
   */
  function addSample(x) {
    stats.n += 1;
    const d = x - stats.mean;
    stats.mean += d / stats.n;
    stats.m2 += d * (x - stats.mean);
    stats.min = Math.min(stats.min, x);
    stats.max = Math.max(stats.max, x);
    trend.push(x);
    if (trend.length > TREND_POINTS) trend.shift();
  }

  /**
   * IT: Stato della misura: 'sat', 'neg', 'nosig' oppure 'ok'. EN: Measurement state: 'sat', 'neg', 'nosig' or 'ok'.
   */
  function classify(inp) {
    const x = inp[K.val];
    if (inp[K.sat]) return 'sat';
    if (x < -cfg.noSignal) return 'neg';
    if (Math.abs(x) < cfg.noSignal) return 'nosig';
    return 'ok';
  }

  /**
   * IT: Zona NAMUR NE 43 di una corrente in mA (solo pagine di corrente).
   * EN: NAMUR NE 43 zone of a current in mA (current pages only).
   */
  function namurZone(ma) {
    if (ma < 3.6) return { key: 'nm_low_fail', kind: 'err' };
    if (ma < 3.8) return { key: 'nm_under', kind: 'warn' };
    if (ma <= 20.5) return { key: 'nm_ok', kind: 'ok' };
    if (ma < 21) return { key: 'nm_over', kind: 'warn' };
    return { key: 'nm_high_fail', kind: 'err' };
  }

  /**
   * IT: Disegna l'andamento con scala automatica (minimo 10 cifre visibili dell'ultima posizione decimale).
   * EN: Draws the trend with auto-scale (at least 10 counts of the last shown decimal).
   */
  function drawTrend() {
    const line = $('tr-line');
    const area = $('tr-area');
    if (trend.length < 2) {
      line.setAttribute('points', '');
      area.setAttribute('points', '');
      $('tr-hi').textContent = '';
      $('tr-lo').textContent = '';
      return;
    }
    let lo = Math.min(...trend);
    let hi = Math.max(...trend);
    const minSpan = 10 * Math.pow(10, -cfg.dec);
    if (hi - lo < minSpan) {
      const mid = (hi + lo) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    const pad = (hi - lo) * 0.1;
    lo -= pad;
    hi += pad;
    const W = 600;
    const H = 160;
    const step = W / (TREND_POINTS - 1);
    const x0 = W - (trend.length - 1) * step;
    const pts = trend.map((v, k) => `${(x0 + k * step).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`);
    line.setAttribute('points', pts.join(' '));
    area.setAttribute('points', `${x0.toFixed(1)},${H} ${pts.join(' ')} ${W},${H}`);
    $('tr-hi').textContent = `${fmt(hi, cfg.dec)} ${cfg.unit}`;
    $('tr-lo').textContent = `${fmt(lo, cfg.dec)} ${cfg.unit}`;
  }

  /**
   * IT: Scrive le statistiche della sessione. EN: Writes the session statistics.
   */
  function renderStats() {
    const u = cfg.unit;
    const has = stats.n > 0;
    $('st-min').textContent = has ? `${fmt(stats.min, cfg.dec)} ${u}` : '–';
    $('st-max').textContent = has ? `${fmt(stats.max, cfg.dec)} ${u}` : '–';
    $('st-mean').textContent = has ? `${fmt(stats.mean, cfg.dec)} ${u}` : '–';
    $('st-pp').textContent = has ? `${fmt(stats.max - stats.min, cfg.dec)} ${u}` : '–';
    const sd = stats.n > 1 ? Math.sqrt(stats.m2 / (stats.n - 1)) : null;
    $('st-sd').textContent = sd === null ? '–' : `${fmt(sd, cfg.dec)} ${u}`;
    $('st-n').textContent = `${stats.n} · ${fmtDuration(Math.round((Date.now() - stats.t0) / 1000))}`;
  }

  /**
   * IT: Aggiorna valore, barra, stato, statistiche, andamento e dettagli tecnici.
   * EN: Updates value, bar, state, statistics, trend and technical details.
   */
  function render(s) {
    lastState = s;
    const inp = s.in;
    const x = inp[K.val];
    const st = classify(inp);

    const chip = $('state');
    const chipKey = held ? 'ms_hold' : `ms_${st}`;
    const chipKind = held ? 'other' : st === 'ok' ? 'on' : st === 'sat' ? 'err' : st === 'neg' ? 'other' : '';
    chip.className = `state-chip${chipKind ? ` ${chipKind}` : ''}`;
    chip.dataset.i18n = chipKey;
    chip.textContent = t(chipKey);
    $('wiring').classList.toggle('is-on', st === 'ok');

    $('sat-alert').hidden = st !== 'sat';
    $('neg-alert').hidden = st !== 'neg';

    if (!held) {
      $('readout').classList.toggle('off', st === 'nosig');
      $('now-val').textContent = st === 'sat' ? '– – –' : fmt(x, cfg.dec);
      const pct = ((x - cfg.lo) / (cfg.hi - cfg.lo)) * 100;
      const span = cfg.ticks[cfg.ticks.length - 1] - cfg.ticks[0];
      const w = Math.max(0, Math.min(100, ((x - cfg.ticks[0]) / span) * 100));
      $('g-fill').style.width = `${st === 'sat' ? 100 : w}%`;
      $('gauge').classList.toggle('sat', st === 'sat' || x > cfg.hi * 1.0005);
      $('pct').textContent = st === 'sat' ? '–' : t('ms_pct', { p: fmt(pct, 1) });
      if ($('namur')) {
        // IT: zone NAMUR NE 43 solo nel campo 4–20 mA / EN: NAMUR NE 43 zones only in the 4–20 mA range
        $('namur').hidden = !cfg.namur;
        if (cfg.namur) {
          const z = namurZone(x);
          $('namur').textContent = t(z.key);
          $('namur').className = `zone ${z.kind}`;
        }
      }
      if (scale) scale.update(st === 'sat' ? null : x, true);
      if (st !== 'sat') addSample(x);
      renderStats();
      drawTrend();
    }

    // IT: Soglie: sempre sul valore vivo (anche in HOLD); se cambia l'unità della scala si aggiornano le etichette
    // EN: Thresholds: always on the live value (also in HOLD); labels follow a change of the scale unit
    if (alarm) {
      const unit = scale.info().unit;
      if (unit !== alarmUnit) { alarmUnit = unit; alarm.relabel(); }
      alarm.update(x, st === 'sat');
    }

    // Dettagli tecnici / Technical details
    const u = cfg.unit;
    setRow('nom', `${fmt(inp[K.nom], cfg.dec)} ${u}`);
    setRow('win', `${fmt(inp[K.max] - inp[K.min], cfg.dec)} ${u}`);
    setRow('code', `${inp[K.code]}`, inp[K.sat] ? 'err' : '');
    setRow('sat', inp[K.sat] ? t('v_yes') : t('v_no'), inp[K.sat] ? 'err' : 'ok');
    const cal = s.cal[cfg.calKey];
    setRow('cal', cal.valid ? t('cal_yes', { d: fmtDate(cal.date) }) : t('v_none'), cal.valid ? 'ok' : 'warn');
    setRow('temp', `${fmt(s.temp, 2)} °C`);
    setRow('conv', `${inp.n} / ${inp.err}`, inp.err ? 'warn' : 'ok');

    // Confronto con l'uscita attiva / Comparison with the active output
    const C = cfg.cmp;
    if (C.match(s.out)) {
      const d = (x - s.out.value) * C.scale;
      const kind = Math.abs(d) <= C.ok ? 'ok' : Math.abs(d) <= C.warn ? 'warn' : '';
      setRow('cmp', `${fmt(s.out.value, cfg.dec)} ${u} · ${t('rb_delta', { d: fmt(d, 1), u: C.unit })}`, kind);
    } else {
      setRow('cmp', t('ms_cmp_off'), '');
    }

    $('fw').textContent = s.fw;
    renderBanner(s.out);
  }

  /**
   * IT: Segni di inizio e fine campo sulla barra. EN: Range start and end marks on the bar.
   */
  function setMarks() {
    const t0 = cfg.ticks[0];
    const span = cfg.ticks[cfg.ticks.length - 1] - t0;
    $('g-lo').style.left = `${((cfg.lo - t0) / span) * 100}%`;
    $('g-lo').hidden = cfg.lo === t0;
    $('g-hi').style.left = `${((cfg.hi - t0) / span) * 100}%`;
  }

  /**
   * IT: Applica il campo del segnale scelto (percentuale, segni, NAMUR). EN: Applies the chosen signal range (percentage, marks, NAMUR).
   */
  function applyRange(r) {
    cfg.lo = r.lo;
    cfg.hi = r.hi;
    cfg.namur = !!r.namur;
    setMarks();
  }

  /**
   * IT: Scrive le etichette che dipendono dalla configurazione (subito e al cambio lingua).
   * EN: Writes the configuration-dependent labels (right away and on language change).
   */
  function setLabels() {
    $('k-cmp').textContent = t('ms_cmp', { p: cfg.cmp.port });
    $('btn-hold').textContent = t(held ? 'btn_resume' : 'btn_hold');
  }

  document.addEventListener('DOMContentLoaded', () => {
    resetStats();
    initChrome(() => { setLabels(); if (lastState) render(lastState); }, render);
    setLabels();

    $('btn-hold').addEventListener('click', () => {
      held = !held;
      $('readout').classList.toggle('held', held);
      $('btn-hold').classList.toggle('btn-primary', held);
      setLabels();
      if (lastState) render(lastState);
    });
    $('btn-reset').addEventListener('click', () => {
      resetStats();
      renderStats();
      drawTrend();
    });

    $('g-ticks').innerHTML = cfg.ticks.map((v) => `<span>${fmt(v, 0)}</span>`).join('');
    setMarks();

    // IT: Scalatura: il campo scelto (4–20 / 0–20 mA) vale anche per la percentuale e le zone NAMUR della pagina
    // EN: Scaling: the chosen range (4–20 / 0–20 mA) also applies to the page percentage and NAMUR zones
    scale = createScale($('p-scale'), {
      kind: 'in', key: cfg.scaleKey, unit: cfg.unit, rawDec: cfg.dec, ranges: cfg.ranges,
      onRange: (r) => { applyRange(r); if (lastState) render(lastState); },
    });
    applyRange(scale.range());
    document.addEventListener('langchange', () => scale.relabel());
    if ($('p-alarm')) {
      alarm = createAlarm($('p-alarm'), { key: cfg.scaleKey.replace('.scale.', '.alarm.'), scale });
      alarmUnit = scale.info().unit;
      document.addEventListener('langchange', () => alarm.relabel());
    }

    startPolling(render);
  });
}
