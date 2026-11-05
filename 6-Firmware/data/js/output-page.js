/*
  IO Tester — logica comune delle pagine di uscita / shared logic of the output pages
  IT: Usata da "Genera tensione" e "Genera corrente": campo valore, valori rapidi, regolazione fine,
      pulsante contestuale ATTIVA/APPLICA, conteggio animato del valore, flusso nei fili, avviso FAULT,
      dettagli tecnici e verifica in loopback. Ogni pagina passa solo la sua configurazione.
  EN: Used by "Generate voltage" and "Generate current": value field, quick values, fine adjustment,
      context ENABLE/APPLY button, animated value count, wire flow, FAULT warning, technical details
      and loopback check. Each page only passes its configuration.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

/**
 * IT: Avvia una pagina di uscita. cfg = { mode, sink, enableKey, api, min, max, unit, def, spKey, calKey, faultKey,
 *     loop: { field, port, scale, unit, ok, warn }, modes, ranges, scaleKey }; sink = true per "Genera Corrente 2F";
 *     modes = modi out.mode di questa pagina (es. [2, 3] = 4–20 e 0–20 mA); ranges = campi del segnale
 *     [{ id, label, lo, hi, min?, q? }]: min = nuovo minimo del valore, q = parametro aggiunto alla richiesta.
 * EN: Starts an output page. cfg = { mode, sink, enableKey, api, min, max, unit, def, spKey, calKey, faultKey,
 *     loop: { field, port, scale, unit, ok, warn }, modes, ranges, scaleKey }; sink = true for "Generate Current 2W";
 *     modes = out.mode values of this page (e.g. [2, 3] = 4–20 and 0–20 mA); ranges = signal ranges
 *     [{ id, label, lo, hi, min?, q? }]: min = new minimum of the value, q = parameter added to the request.
 */
function initOutputPage(cfg) {
  let lastState = null;
  let busy = false;
  let applied = null;   // IT: ultimo valore applicato (null = spenta) / EN: last applied value (null = off)
  let wasOn = false;    // IT: stato precedente (animazione di accensione) / EN: previous state (turn-on animation)
  let shown = 0;        // IT: valore mostrato (animato) / EN: shown value (animated)
  let anim = 0;
  let scale = null;     // IT: pannello operatore / EN: operator panel
  let rangeQ = '';      // IT: parametro del campo (es. &range=0) / EN: range parameter (e.g. &range=0)
  const modes = cfg.modes || [cfg.mode];

  /**
   * IT: true se è attiva questa uscita (e non il sink). EN: true if this output (not the sink) is on.
   */
  function isOn(s) {
    if (!s) return false;
    return cfg.sink ? !!s.out.sink : modes.includes(s.out.mode) && !s.out.sink;
  }

  /**
   * IT: true se è attiva un'altra uscita. EN: true if another output is on.
   */
  function otherOn(s) {
    if (!s) return false;
    return cfg.sink ? !s.out.sink && s.out.mode !== 0 : s.out.sink || (s.out.mode !== 0 && !modes.includes(s.out.mode));
  }

  /**
   * IT: true se il sistema chiede animazioni ridotte. EN: true if the system asks for reduced motion.
   */
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * IT: Porta il numero grande al valore dato con un conteggio di 450 ms (ease-out).
   * EN: Moves the large number to the given value with a 450 ms count (ease-out).
   */
  function animateReadout(to) {
    const el = $('now-val');
    cancelAnimationFrame(anim);
    if (reducedMotion() || Math.abs(to - shown) < 0.0005) {
      shown = to;
      el.textContent = fmt(to, 3);
      return;
    }
    const from = shown;
    let t0 = null;
    const step = (now) => {
      if (t0 === null) t0 = now;
      const k = Math.max(0, Math.min(1, (now - t0) / 450));
      shown = from + (to - from) * (1 - Math.pow(1 - k, 3));
      el.textContent = fmt(shown, 3);
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  /**
   * IT: Effetto di accensione del valore. EN: Value turn-on effect.
   */
  function popReadout() {
    const r = $('readout');
    r.classList.remove('pop');
    void r.offsetWidth;
    r.classList.add('pop');
    r.addEventListener('animationend', () => r.classList.remove('pop'), { once: true });
  }

  /**
   * IT: Legge il valore dal campo (virgola o punto); null se fuori campo, con messaggio.
   * EN: Reads the value from the field (comma or dot); null if out of range, with a message.
   */
  function readSetpoint() {
    const raw = $('sp').value.trim().replace(',', '.');
    const v = Number(raw);
    const ok = raw !== '' && Number.isFinite(v) && v >= cfg.min && v <= cfg.max;
    $('sp-field').classList.toggle('err', !ok);
    $('sp-err').textContent = ok ? '' : t('sp_err', { min: fmt(cfg.min, 0), max: fmt(cfg.max, 0), u: cfg.unit });
    return ok ? v : null;
  }

  /**
   * IT: Scrive un valore nel campo (3 decimali, limitato al campo) e lo ricorda nel browser.
   * EN: Writes a value into the field (3 decimals, clamped) and remembers it in the browser.
   */
  function writeSetpoint(v) {
    const c = Math.min(cfg.max, Math.max(cfg.min, Math.round(v * 1000) / 1000));
    $('sp').value = fmt(c, 3);
    $('sp-field').classList.remove('err');
    $('sp-err').textContent = '';
    try { localStorage.setItem(cfg.spKey, String(c)); } catch (e) { /* IT/EN: opzionale / optional */ }
    return c;
  }

  /**
   * IT: Invia il valore all'ESP32 e aggiorna la pagina. EN: Sends the value to the ESP32 and updates the page.
   */
  async function apply() {
    const v = readSetpoint();
    if (v === null || busy) return;
    busy = true;
    try {
      const s = await request(`${cfg.api}?value=${v}${rangeQ}`, { method: 'POST' });
      applied = v;
      render(s);
    } catch (e) {
      setConn('cmd_fail', 'err');
    } finally {
      busy = false;
    }
  }

  /**
   * IT: Pulsante contestuale: ATTIVA se spenta, APPLICA x solo se il valore scritto è cambiato, altrimenti nascosto.
   * EN: Context button: ENABLE when off, APPLY x only if the typed value changed, otherwise hidden.
   */
  function updateApplyButton() {
    const on = isOn(lastState);
    const v = readSetpoint();
    const pending = on && v !== null && applied !== null && Math.abs(v - applied) > 0.0005;
    const btn = $('btn-apply');
    const show = !on || pending;
    btn.hidden = !show;
    btn.parentElement.classList.toggle('single', !show);
    btn.classList.toggle('ready', !on);
    if (!on) {
      btn.dataset.i18n = cfg.enableKey || 'btn_enable';
      btn.textContent = t(btn.dataset.i18n);
    } else if (pending) {
      delete btn.dataset.i18n;
      btn.textContent = t('btn_apply_v', { v: fmt(v, 3), u: cfg.unit });
    }
  }

  /**
   * IT: Scrive l'etichetta della riga di verifica (subito all'avvio e al cambio lingua, senza attendere lo stato).
   * EN: Writes the check-row label (right at start-up and on language change, without waiting for the state).
   */
  function setLoopLabel() {
    $('k-loop').textContent = t('rb_loop', { p: cfg.loop.port });
  }

  /**
   * IT: Aggiorna stato, valore, animazioni, pulsanti, avviso FAULT e dettagli tecnici.
   * EN: Updates state, value, animations, buttons, FAULT warning and technical details.
   */
  function render(s) {
    lastState = s;
    const on = isOn(s);
    const other = otherOn(s);

    const chip = $('state');
    chip.className = `state-chip${on ? ' on' : other ? ' other' : ''}`;
    chip.dataset.i18n = on ? 'st_on' : other ? 'st_other' : 'st_off';
    chip.textContent = t(chip.dataset.i18n);

    $('readout').classList.toggle('off', !on);
    animateReadout(on ? s.out.value : 0);   // IT: spenta = 0 / EN: off = 0
    if (on && !wasOn) popReadout();
    wasOn = on;
    $('wiring').classList.toggle('is-on', on);
    $('p-set').classList.toggle('is-on', on);

    if (on && applied === null) applied = writeSetpoint(s.out.value);
    if (!on) applied = null;
    updateApplyButton();
    $('switch-note').hidden = !other;

    const fault = $('fault-alert');
    fault.hidden = !(on && s.out.fault);
    fault.textContent = t(cfg.faultKey);

    // Dettagli tecnici / Technical details
    const u = cfg.unit;
    setRow('exp', on ? `${fmt(s.out.value, 4)} ${u}` : '–');
    setRow('nom', on ? `${fmt(s.out.nominal, 4)} ${u}` : '–');
    const codeOk = !on || s.out.code === s.out.code_rb;
    setRow('code', on ? `${s.out.code} / ${s.out.code_rb}` : '–', on ? (codeOk ? 'ok' : 'err') : '');
    setRow('ctrl', `0x${s.out.ctrl.toString(16).toUpperCase().padStart(4, '0')}`);
    setRow('fault', s.out.fault ? t('v_yes') : t('v_no'), s.out.fault ? 'err' : 'ok');
    const cal = s.cal[cfg.calKey];
    setRow('cal', cal.valid ? t('cal_yes', { d: fmtDate(cal.date) }) : t('v_none'), cal.valid ? 'ok' : 'warn');

    // Verifica in loopback sull'ingresso / Loopback check on the input
    const L = cfg.loop;
    const inVal = s.in[L.field];
    if (on) {
      const d = (inVal - s.out.value) * L.scale;
      const kind = Math.abs(d) <= L.ok ? 'ok' : Math.abs(d) <= L.warn ? 'warn' : '';
      setRow('loop', `${fmt(inVal, 4)} ${u} · ${t('rb_delta', { d: fmt(d, 1), u: L.unit })}`, kind);
    } else {
      setRow('loop', `${fmt(inVal, 4)} ${u}`, '');
    }

    if (scale) scale.update(on ? s.out.value : null, on);
    $('fw').textContent = s.fw;
    renderBanner(s.out);
  }

  /**
   * IT: Applica il campo scelto: minimo del valore e parametro della richiesta; se l'uscita è attiva la riporta nel nuovo campo.
   * EN: Applies the chosen range: value minimum and request parameter; if the output is on it moves it into the new range.
   */
  function applyRange(r) {
    if (r.min !== undefined) cfg.min = r.min;
    rangeQ = r.q || '';
    const v = Number($('sp').value.trim().replace(',', '.'));
    writeSetpoint(Number.isFinite(v) ? v : cfg.def);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initChrome(() => { setLoopLabel(); if (lastState) render(lastState); writeSetpoint(readSetpoint() ?? cfg.def); }, render);
    setLoopLabel();

    let saved = cfg.def;
    try { saved = Number(localStorage.getItem(cfg.spKey) ?? cfg.def); } catch (e) { /* IT/EN: opzionale / optional */ }
    writeSetpoint(Number.isFinite(saved) ? saved : cfg.def);

    document.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
      writeSetpoint(Number(b.dataset.v));
      if (isOn(lastState)) apply();
    }));
    document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const cur = readSetpoint() ?? cfg.min;
      writeSetpoint(cur + Number(b.dataset.step));
      if (isOn(lastState)) apply();
    }));
    $('sp').addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    $('sp').addEventListener('input', () => { readSetpoint(); updateApplyButton(); });
    $('btn-apply').addEventListener('click', apply);
    $('btn-stop').addEventListener('click', async () => {
      const s = await switchOff();
      if (s) render(s);
    });

    // IT: Pannello operatore: comando in % o in unità ingegneristiche → valore elettrico nel campo scelto
    // EN: Operator panel: command in % or engineering units → electrical value in the chosen range
    if (cfg.ranges && $('p-scale')) {
      scale = createScale($('p-scale'), {
        kind: 'out', key: cfg.scaleKey, unit: cfg.unit, rawDec: 3, ranges: cfg.ranges,
        isOn: () => isOn(lastState),
        onRange: (r) => applyRange(r),
        onCommand: (raw) => {
          writeSetpoint(raw);
          if (isOn(lastState)) apply();
          else updateApplyButton();
        },
      });
      applyRange(scale.range());
      document.addEventListener('langchange', () => scale.relabel());
    }

    startPolling(render);
  });
}
