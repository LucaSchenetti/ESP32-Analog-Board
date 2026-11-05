/*
  IO Tester — scalatura in unità ingegneristiche / engineering-unit scaling
  IT: Pannello comune alle pagine di misura ("Scalatura Ingresso") e di uscita ("Pannello Operatore"), come
      la funzione SCALE / UNSCALE di un PLC: campo del segnale (es. 4–20 o 0–20 mA), zero = valore a 0 %,
      span = valore a 100 %, unità e decimali.
      - Ingresso: segnale → percentuale → valore scalato, con sotto/sopra scala.
      - Uscita: l'operatore sceglie il valore in % o in unità (cursore, valori rapidi, regolazione fine) e il
        pannello calcola il segnale elettrico da generare.
      Le impostazioni restano nel browser (per pagina).
  EN: Panel shared by the measurement pages ("Input Scaling") and the output pages ("Operator Panel"), like
      a PLC SCALE / UNSCALE function: signal range (e.g. 4–20 or 0–20 mA), zero = value at 0 %, span = value
      at 100 %, unit and decimals.
      - Input: signal → percentage → scaled value, with under/over range.
      - Output: the operator picks the value in % or in units (slider, quick values, fine adjustment) and
        the panel computes the electrical signal to generate.
      Settings stay in the browser (per page).
  Richiede / requires: i18n.js, common.js.
*/
'use strict';

// IT: Unità più usate in automazione, per grandezza (chiave del nome del gruppo in i18n)
// EN: Units most used in automation, by quantity (i18n key of the group name)
const SCALE_UNITS = [
  { g: 'sc_g_pct', u: ['%'] },
  { g: 'sc_g_press', u: ['bar', 'mbar', 'kPa', 'MPa', 'Pa', 'psi'] },
  { g: 'sc_g_temp', u: ['°C', '°F', 'K'] },
  { g: 'sc_g_flow', u: ['m³/h', 'L/min', 'L/h', 'Nm³/h', 't/h', 'kg/h'] },
  { g: 'sc_g_level', u: ['m', 'cm', 'mm'] },
  { g: 'sc_g_mass', u: ['kg', 't'] },
  { g: 'sc_g_speed', u: ['rpm', 'Hz', 'm/s'] },
  { g: 'sc_g_elec', u: ['V', 'mA', 'A', 'kW'] },
  { g: 'sc_g_chem', u: ['pH', 'ppm', 'µS/cm', '%RH'] },
];
const SCALE_PRESETS = [
  { zero: 0, span: 100, unit: '%', dec: 1 },
  { zero: 0, span: 10, unit: 'bar', dec: 2 },
  { zero: -50, span: 150, unit: '°C', dec: 1 },
  { zero: 0, span: 100, unit: 'm³/h', dec: 1 },
];

/**
 * IT: Crea il pannello di scalatura dentro host. opts = { kind: 'in'|'out', key, unit, rawDec,
 *     ranges: [{ id, label, lo, hi, … }], onRange(range), onCommand(raw), isOn() }. Restituisce { update, range, relabel }.
 * EN: Creates the scaling panel inside host. opts = { kind: 'in'|'out', key, unit, rawDec,
 *     ranges: [{ id, label, lo, hi, … }], onRange(range), onCommand(raw), isOn() }. Returns { update, range, relabel }.
 */
function createScale(host, opts) {
  const isOut = opts.kind === 'out';
  const st = { range: opts.ranges[0].id, zero: 0, span: 100, unit: '%', dec: 1, pct: 50 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(opts.key) || '{}')); } catch (e) { /* IT/EN: opzionale / optional */ }
  if (!opts.ranges.some((r) => r.id === st.range)) st.range = opts.ranges[0].id;
  let last = { raw: null, on: false };
  const uid = opts.key.replace(/\W/g, '');

  /**
   * IT: Salva le impostazioni nel browser. EN: Saves the settings in the browser.
   */
  function save() {
    try { localStorage.setItem(opts.key, JSON.stringify(st)); } catch (e) { /* IT/EN: opzionale / optional */ }
  }

  /**
   * IT: Campo del segnale scelto. EN: Chosen signal range.
   */
  function range() {
    return opts.ranges.find((r) => r.id === st.range) || opts.ranges[0];
  }

  /**
   * IT: true se zero e span sono validi. EN: true if zero and span are valid.
   */
  function valid() {
    return Number.isFinite(st.zero) && Number.isFinite(st.span) && st.zero !== st.span;
  }

  // IT: Conversioni segnale ↔ % ↔ unità / EN: Conversions signal ↔ % ↔ units
  const toPct = (raw) => ((raw - range().lo) / (range().hi - range().lo)) * 100;
  const fromPct = (p) => range().lo + ((range().hi - range().lo) * p) / 100;
  const toEng = (p) => st.zero + ((st.span - st.zero) * p) / 100;
  const engToPct = (e) => ((e - st.zero) / (st.span - st.zero)) * 100;
  const engText = (e) => `${fmt(e, st.dec)}${st.unit ? ` ${st.unit}` : ''}`;
  const rawText = (raw) => `${fmt(raw, opts.rawDec)} ${opts.unit}`;

  /**
   * IT: Numero da un campo di testo (virgola o punto); null se non valido. EN: Number from a text field (comma or dot); null if invalid.
   */
  function num(v) {
    const raw = String(v).trim().replace(',', '.');
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) ? n : null;
  }

  /**
   * IT: Costruisce il pannello (anche al cambio lingua; i valori vengono da st). EN: Builds the panel (also on language change; values come from st).
   */
  function build() {
    const ranges = opts.ranges.length > 1
      ? `<div class="seg seg-wide sc-ranges" role="group">${opts.ranges.map((r) =>
        `<button type="button" data-sr="${r.id}" aria-pressed="${r.id === st.range}">${r.label}</button>`).join('')}</div>`
      : `<div class="sc-fixed">${opts.ranges[0].label}</div>`;
    const cmd = isOut ? `
      <input id="sc-slider" class="sc-slider" type="range" min="0" max="100" step="0.1" value="${st.pct}" aria-label="%">
      <div class="sc-ticks"><span>0 %</span><span>25 %</span><span>50 %</span><span>75 %</span><span>100 %</span></div>
      <div class="btn-row cols-5">${[0, 25, 50, 75, 100].map((p) => `<button class="btn" type="button" data-sp="${p}">${p} %</button>`).join('')}</div>
      <div class="btn-row cols-4">${[-1, -0.1, 0.1, 1].map((d) => `<button class="btn" type="button" data-sd="${d}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d), d % 1 ? 1 : 0)} %</button>`).join('')}</div>
      <div class="sc-cmd">
        <label class="sc-f"><span class="k">${t('sc_cmd_pct')}</span><span class="field"><input id="sc-in-pct" type="text" inputmode="decimal" autocomplete="off"><span class="unit">%</span></span></label>
        <label class="sc-f"><span class="k">${t('sc_cmd_eng')}</span><span class="field"><input id="sc-in-eng" type="text" inputmode="decimal" autocomplete="off"><span id="sc-in-unit" class="unit"></span></span></label>
      </div>
      <p id="sc-elec" class="sc-elec"></p>
      <p class="hint">${t('sc_cmd_hint')}</p>` : '';
    host.innerHTML = `
      <div class="panel-head"><h2><svg class="icon"><use href="img/icons.svg#ic-scale"/></svg><span>${t(isOut ? 'sc_out_title' : 'sc_in_title')}</span></h2><span class="summary-sub">${t(isOut ? 'sc_out_sub' : 'sc_in_sub')}</span></div>
      <span id="sc-lbl" class="label"></span>
      <div class="readout sc-read"><span id="sc-val" class="num">–</span><span id="sc-unit" class="unit"></span></div>
      <div class="sc-bar"><div id="sc-fill" class="sc-fill"></div></div>
      <div class="meas-meta"><span id="sc-pct">–</span><span id="sc-zone" class="zone" hidden></span></div>
      ${cmd}
      <div class="sc-conf">
        <span class="label">${t('sc_range')}</span>
        ${ranges}
        <div class="sc-grid">
          <label class="sc-f"><span class="k">${t('sc_zero')} <small>${t('sc_zero_h')}</small></span><span class="field"><input id="sc-zero" type="text" inputmode="decimal" autocomplete="off" value="${fmt(st.zero, st.dec)}"></span></label>
          <label class="sc-f"><span class="k">${t('sc_span')} <small>${t('sc_span_h')}</small></span><span class="field"><input id="sc-span" type="text" inputmode="decimal" autocomplete="off" value="${fmt(st.span, st.dec)}"></span></label>
          <div class="sc-f"><span class="k">${t('sc_unit')}</span>
            <div class="combo">
              <span class="field"><input id="sc-u" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="8" value="${st.unit}" role="combobox" aria-expanded="false" aria-controls="sc-ulist-${uid}"><button id="sc-u-btn" class="combo-btn" type="button" tabindex="-1" aria-label="${t('sc_unit')}">▾</button></span>
              <div id="sc-ulist-${uid}" class="combo-list" role="listbox" hidden></div>
            </div>
          </div>
          <div class="sc-f"><span class="k">${t('sc_dec')}</span><div class="seg seg-wide sc-dec" role="group">${[0, 1, 2, 3].map((d) =>
            `<button type="button" data-dec="${d}" aria-pressed="${d === st.dec}">${d}</button>`).join('')}</div></div>
        </div>
        <div class="sc-presets">${SCALE_PRESETS.map((p, k) =>
          `<button class="chip" type="button" data-pre="${k}">${fmt(p.zero, 0)} … ${fmt(p.span, 0)} ${p.unit}</button>`).join('')}</div>
        <p id="sc-map" class="hint mono"></p>
        <p id="sc-err" class="err-text"></p>
      </div>`;
    wire();
    refresh();
  }

  /**
   * IT: Collega gli eventi del pannello. EN: Wires the panel events.
   */
  function wire() {
    host.querySelectorAll('[data-sr]').forEach((b) => b.addEventListener('click', () => {
      st.range = b.dataset.sr;
      save();
      host.querySelectorAll('[data-sr]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (opts.onRange) opts.onRange(range());
      if (isOut && opts.isOn && opts.isOn()) command(st.pct);
      refresh();
    }));
    host.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
      st.dec = Number(b.dataset.dec);
      save();
      host.querySelectorAll('[data-dec]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      refresh();
    }));
    const conf = () => {
      const z = num($('sc-zero').value);
      const s = num($('sc-span').value);
      if (z !== null) st.zero = z;
      if (s !== null) st.span = s;
      st.unit = $('sc-u').value.trim();
      save();
      refresh();
    };
    ['sc-zero', 'sc-span', 'sc-u'].forEach((id) => $(id).addEventListener('input', conf));
    wireUnits(conf);
    host.querySelectorAll('[data-pre]').forEach((b) => b.addEventListener('click', () => {
      Object.assign(st, SCALE_PRESETS[Number(b.dataset.pre)]);
      save();
      build();
    }));
    if (!isOut) return;
    const slider = $('sc-slider');
    slider.addEventListener('input', () => preview(Number(slider.value)));
    slider.addEventListener('change', () => command(Number(slider.value)));
    host.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => command(Number(b.dataset.sp))));
    host.querySelectorAll('[data-sd]').forEach((b) => b.addEventListener('click', () => command(st.pct + Number(b.dataset.sd))));
    $('sc-in-pct').addEventListener('keydown', (e) => {
      const p = num(e.target.value);
      if (e.key === 'Enter' && p !== null) command(p);
    });
    $('sc-in-eng').addEventListener('keydown', (e) => {
      const v = num(e.target.value);
      if (e.key === 'Enter' && v !== null && valid()) command(engToPct(v));
    });
    ['sc-in-pct', 'sc-in-eng'].forEach((id) => $(id).addEventListener('change', (e) => {
      const v = num(e.target.value);
      if (v === null) return;
      command(id === 'sc-in-pct' ? v : valid() ? engToPct(v) : st.pct);
    }));
  }

  /**
   * IT: Tendina delle unità: si apre al tocco (elenco completo per grandezza), filtra mentre si scrive, accetta testo libero.
   * EN: Unit drop-down: opens on tap (full list by quantity), filters while typing, accepts free text.
   */
  function wireUnits(conf) {
    const input = $('sc-u');
    const list = $(`sc-ulist-${uid}`);
    const open = (filter) => {
      const f = (filter || '').trim().toLowerCase();
      const groups = SCALE_UNITS.map((grp) => ({ g: grp.g, u: grp.u.filter((u) => !f || u.toLowerCase().includes(f)) }))
        .filter((grp) => grp.u.length);
      list.innerHTML = groups.length
        ? groups.map((grp) => `<div class="combo-g">${t(grp.g)}</div>${grp.u.map((u) =>
          `<button type="button" class="combo-i${u === st.unit ? ' sel' : ''}" data-u="${u}" role="option">${u}</button>`).join('')}`).join('')
        : `<div class="combo-g">${t('sc_unit_free')}</div>`;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    input.addEventListener('focus', () => open(''));
    input.addEventListener('click', () => open(''));
    input.addEventListener('input', () => open(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { close(); input.blur(); } });
    input.addEventListener('blur', () => setTimeout(close, 150));
    $('sc-u-btn').addEventListener('pointerdown', (e) => {
      e.preventDefault();   // IT: non togliere il fuoco al campo / EN: do not steal focus from the field
      if (list.hidden) { input.focus(); open(''); } else close();
    });
    // IT: pointerdown prima del blur del campo / EN: pointerdown before the field blur
    list.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-u]');
      e.preventDefault();
      if (!b) return;
      input.value = b.dataset.u;
      conf();
      close();
      input.blur();
    });
  }

  /**
   * IT: Uscita: aggiorna la sola anteprima (trascinamento del cursore). EN: Output: preview only (slider drag).
   */
  function preview(p) {
    const pct = Math.max(0, Math.min(100, p));
    $('sc-in-pct').value = fmt(pct, 1);
    $('sc-in-eng').value = valid() ? fmt(toEng(pct), st.dec) : '';
    $('sc-elec').innerHTML = t('sc_elec', { v: `<b>${rawText(fromPct(pct))}</b>` });
    if (!last.on) showValue(pct);
  }

  /**
   * IT: Uscita: invia il comando in % (limitato a 0…100 %). EN: Output: sends the command in % (limited to 0…100 %).
   */
  function command(p) {
    if (!valid()) return;
    st.pct = Math.round(Math.max(0, Math.min(100, p)) * 100) / 100;
    save();
    $('sc-slider').value = st.pct;
    preview(st.pct);
    if (opts.onCommand) opts.onCommand(Math.round(fromPct(st.pct) * 10000) / 10000);
    refresh();
  }

  /**
   * IT: Valore grande, barra, percentuale e zona (sotto/sopra scala). EN: Large value, bar, percentage and zone (under/over range).
   */
  function showValue(pct) {
    const ok = valid() && pct !== null && Number.isFinite(pct);
    $('sc-val').textContent = ok ? fmt(toEng(pct), st.dec) : '–';
    $('sc-unit').textContent = st.unit;
    $('sc-fill').style.width = `${ok ? Math.max(0, Math.min(100, pct)) : 0}%`;
    $('sc-pct').textContent = ok ? t('sc_pct', { p: fmt(pct, 1) }) : '–';
    const z = $('sc-zone');
    const under = ok && pct < -0.05;
    const over = ok && pct > 100.05;
    z.hidden = !(under || over);
    z.className = 'zone warn';
    z.textContent = t(under ? 'sc_under' : 'sc_over');
    host.classList.toggle('sc-out-range', under || over);
  }

  /**
   * IT: Aggiorna testi di configurazione, errori e valore (con l'ultimo segnale ricevuto).
   * EN: Updates configuration texts, errors and value (with the last received signal).
   */
  function refresh() {
    const r = range();
    $('sc-err').textContent = valid() ? '' : t('sc_err_span');
    $('sc-map').textContent = valid()
      ? `${rawText(r.lo)} → ${engText(st.zero)}   ·   ${rawText(r.hi)} → ${engText(st.span)}`
      : '';
    if (isOut) {
      $('sc-in-unit').textContent = st.unit;
      $('sc-slider').value = st.pct;
      preview(st.pct);
      $('sc-lbl').textContent = t(last.on ? 'sc_now' : 'sc_cmd_off');
      showValue(last.on && last.raw !== null ? toPct(last.raw) : st.pct);
    } else {
      $('sc-lbl').textContent = t('sc_value');
      showValue(last.raw === null ? null : toPct(last.raw));
    }
  }

  build();
  return {
    /**
     * IT: Nuovo segnale (misura, oppure uscita attiva) e stato acceso/spento. EN: New signal (measurement, or active output) and on/off state.
     */
    update(raw, on) {
      last = { raw, on: !!on };
      refresh();
    },
    range,
    /**
     * IT: Valore in unità ingegneristiche di un segnale (null se la scala non è valida). EN: Engineering value of a signal (null if the scale is invalid).
     */
    eng: (raw) => (valid() && raw !== null && Number.isFinite(raw) ? toEng(toPct(raw)) : null),
    /**
     * IT: Unità, decimali e ampiezza della scala (span − zero). EN: Unit, decimals and scale width (span − zero).
     */
    info: () => ({ unit: st.unit, dec: st.dec, width: Math.abs(st.span - st.zero) }),
    /**
     * IT: Ricostruisce i testi nella nuova lingua. EN: Rebuilds the texts in the new language.
     */
    relabel: build,
  };
}
