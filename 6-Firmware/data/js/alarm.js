/*
  IO Tester — soglie e allarme acustico nelle pagine di misura / thresholds and audible alarm on measurement pages
  IT: Soglia bassa e alta nelle unità della scalatura (scale.js), isteresi dell'1% della scala per evitare
      allarmi intermittenti, stato NORMALE / ALLARME ALTO / ALLARME BASSO / FUORI SCALA, cicalino dello strumento
      (bip ogni secondo finché dura, tacitabile). Funziona finché la pagina è aperta. Impostazioni nel browser.
  EN: Low and high threshold in the scaling units (scale.js), 1% of scale hysteresis to avoid chattering alarms,
      NORMAL / HIGH ALARM / LOW ALARM / OVER-RANGE state, instrument buzzer (beep every second while it lasts,
      can be silenced). Works while the page is open. Settings stay in the browser.
  Richiede / requires: i18n.js, common.js, scale.js.
*/
'use strict';

/**
 * IT: Crea il pannello delle soglie dentro host. opts = { key, scale }. Restituisce { update(raw, sat), relabel }.
 * EN: Creates the threshold panel inside host. opts = { key, scale }. Returns { update(raw, sat), relabel }.
 */
function createAlarm(host, opts) {
  const st = { on: false, lo: '', hi: '', buzz: true };
  try { Object.assign(st, JSON.parse(localStorage.getItem(opts.key) || '{}')); } catch (e) { /* IT/EN: opzionale / optional */ }
  let state = 'off';     // IT: off | ok | hi | lo | sat / EN: off | ok | hi | lo | sat
  let muted = false;
  let lastEng = null;
  let beepTimer = 0;

  /**
   * IT: Salva le impostazioni. EN: Saves the settings.
   */
  function save() {
    try { localStorage.setItem(opts.key, JSON.stringify(st)); } catch (e) { /* IT/EN: opzionale / optional */ }
  }

  /**
   * IT: Numero dalla soglia scritta (virgola o punto); null se vuota o non valida. EN: Number from the typed threshold; null if empty or invalid.
   */
  function num(v) {
    const raw = String(v).trim().replace(',', '.');
    const n = Number(raw);
    return raw !== '' && Number.isFinite(n) ? n : null;
  }

  /**
   * IT: Costruisce il pannello (anche al cambio lingua). EN: Builds the panel (also on language change).
   */
  function build() {
    const u = opts.scale.info().unit;
    host.innerHTML = `
      <div class="panel-head"><h2><svg class="icon"><use href="img/icons.svg#ic-bell"/></svg><span>${t('al_title')}</span></h2><span class="summary-sub">${t('al_sub')}</span></div>
      <div class="seg seg-wide" role="group">
        <button type="button" data-al="0" aria-pressed="${!st.on}">${t('al_off')}</button>
        <button type="button" data-al="1" aria-pressed="${st.on}">${t('al_on')}</button>
      </div>
      <div id="al-state" class="al-state"></div>
      <div class="sc-grid">
        <label class="sc-f"><span class="k">${t('al_lo')}</span><span class="field"><input id="al-lo" type="text" inputmode="decimal" autocomplete="off" value="${st.lo}" placeholder="—"><span class="unit">${u}</span></span></label>
        <label class="sc-f"><span class="k">${t('al_hi')}</span><span class="field"><input id="al-hi" type="text" inputmode="decimal" autocomplete="off" value="${st.hi}" placeholder="—"><span class="unit">${u}</span></span></label>
      </div>
      <div class="sc-f al-buzz"><span class="k">${t('al_buzz')}</span><div class="seg seg-wide" role="group">
        <button type="button" data-bz="1" aria-pressed="${st.buzz}">${t('v_yes')}</button>
        <button type="button" data-bz="0" aria-pressed="${!st.buzz}">${t('v_no')}</button></div></div>
      <div class="actions single"><button id="al-mute" class="btn btn-lg btn-danger" type="button" hidden>${t('al_mute')}</button></div>
      <p class="hint">${t('al_hint')}</p>`;
    host.querySelectorAll('[data-al]').forEach((b) => b.addEventListener('click', () => {
      st.on = b.dataset.al === '1';
      save();
      host.querySelectorAll('[data-al]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      muted = false;
      evaluate(lastEng, false);
    }));
    host.querySelectorAll('[data-bz]').forEach((b) => b.addEventListener('click', () => {
      st.buzz = b.dataset.bz === '1';
      save();
      host.querySelectorAll('[data-bz]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    }));
    ['al-lo', 'al-hi'].forEach((id) => $(id).addEventListener('input', () => {
      st.lo = $('al-lo').value.trim();
      st.hi = $('al-hi').value.trim();
      save();
      evaluate(lastEng, false);
    }));
    $('al-mute').addEventListener('click', () => { muted = true; render(); });
    render();
  }

  /**
   * IT: Nuovo stato con isteresi: si entra in allarme oltre la soglia, si esce rientrando dell'1% della scala.
   * EN: New state with hysteresis: alarm beyond the threshold, cleared when back by 1% of the scale.
   */
  function evaluate(eng, sat) {
    lastEng = eng;
    const lo = num(st.lo);
    const hi = num(st.hi);
    const hyst = opts.scale.info().width * 0.01;
    let next = 'ok';
    if (!st.on || (lo === null && hi === null)) next = 'off';
    else if (sat) next = 'sat';
    else if (eng === null) next = state === 'off' ? 'ok' : state;
    else if (hi !== null && (eng > hi || (state === 'hi' && eng > hi - hyst))) next = 'hi';
    else if (lo !== null && (eng < lo || (state === 'lo' && eng < lo + hyst))) next = 'lo';
    if (next !== state && (next === 'ok' || next === 'off')) muted = false;
    state = next;
    render();
  }

  /**
   * IT: Stato visibile e cicalino (bip di 200 ms a 3 kHz ogni secondo). EN: Visible state and buzzer (200 ms beep at 3 kHz every second).
   */
  function render() {
    const box = $('al-state');
    if (!box) return;
    const alarm = state === 'hi' || state === 'lo' || state === 'sat';
    const key = { off: 'al_st_off', ok: 'al_st_ok', hi: 'al_st_hi', lo: 'al_st_lo', sat: 'al_st_sat' }[state];
    const u = opts.scale.info().unit;
    const val = lastEng === null ? '' : ` · ${fmt(lastEng, opts.scale.info().dec)} ${u}`;
    box.className = `al-state ${state}`;
    box.textContent = `${t(key)}${state === 'off' ? '' : val}`;
    host.classList.toggle('al-alarm', alarm);
    $('al-mute').hidden = !(alarm && st.buzz && !muted);
    const beep = alarm && st.buzz && !muted;
    if (beep && !beepTimer) {
      const go = () => fetch('/api/buzzer?f=3000&ms=200', { method: 'POST' }).catch(() => {});
      go();
      beepTimer = setInterval(go, 1000);
    } else if (!beep && beepTimer) {
      clearInterval(beepTimer);
      beepTimer = 0;
    }
  }

  build();
  return {
    /**
     * IT: Nuova misura (segnale grezzo) e fuori scala. EN: New measurement (raw signal) and over-range.
     */
    update(raw, sat) {
      evaluate(sat ? null : opts.scale.eng(raw), sat);
    },
    /**
     * IT: Ricostruisce i testi (lingua o unità cambiate). EN: Rebuilds the texts (language or unit changed).
     */
    relabel: build,
  };
}
