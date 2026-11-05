/*
  IO Tester — funzioni comuni a tutte le pagine / functions shared by all pages
  IT: Richieste HTTP, formattazione numeri, indicatori, connessione, barra "uscita attiva" con
      spegnimento, aggiornamento periodico dello stato, lingua e tema nella barra in alto.
  EN: HTTP requests, number formatting, indicators, connection, "active output" bar with
      switch-off, periodic state refresh, language and theme in the top bar.
  Richiede / requires: theme.js, i18n.js.
*/
'use strict';

const API = {
  state: '/api/state',
  off: '/api/out/off',
  outV: '/api/out/v',
  outI: '/api/out/i',
  outSink: '/api/out/sink',
};
const POLL_MS = 1000;       // IT: intervallo di aggiornamento / EN: refresh interval
const TIMEOUT_MS = 2500;    // IT: timeout richiesta / EN: request timeout

/**
 * IT: Restituisce l'elemento con l'id dato. EN: Returns the element with the given id.
 */
const $ = (id) => document.getElementById(id);

/**
 * IT: Locale numerico della lingua attiva. EN: Number locale of the active language.
 */
function locale() {
  return getLang() === 'it' ? 'it-IT' : 'en-GB';
}

/**
 * IT: Formatta un numero nella lingua attiva con un numero fisso di decimali ("–" se assente).
 * EN: Formats a number in the active language with a fixed number of decimals ("–" if missing).
 */
function fmt(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return Number(value).toLocaleString(locale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * IT: Durata leggibile da secondi (es. "2 h 05 min"). EN: Readable duration from seconds (e.g. "2 h 05 min").
 */
function fmtDuration(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s} s`;
}

/**
 * IT: Data breve dalla epoch UNIX. EN: Short date from UNIX epoch.
 */
function fmtDate(epoch) {
  return new Date(epoch * 1000).toLocaleDateString(locale());
}

/**
 * IT: Esegue una richiesta HTTP con timeout e restituisce il JSON.
 * EN: Performs an HTTP request with timeout and returns the JSON.
 */
async function request(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * IT: Aggiorna un indicatore a pallino: '' (neutro), 'ok', 'warn', 'err', con 'live' opzionale.
 * EN: Updates a dot indicator: '' (neutral), 'ok', 'warn', 'err', with optional 'live'.
 */
function setDot(id, kind, live = false) {
  const el = $(id);
  if (el) el.className = `dot ${kind}${live ? ' live' : ''}`;
}

/**
 * IT: Scrive il valore della riga "s-<id>" e lo stato del pallino "d-<id>".
 * EN: Writes the value of row "s-<id>" and the state of dot "d-<id>".
 */
function setRow(id, text, kind) {
  const el = $(`s-${id}`);
  if (el) el.textContent = text;
  if (kind !== undefined) setDot(`d-${id}`, kind);
}

const conn = { key: 'conn_wait', kind: '' };

/**
 * IT: Mostra lo stato della connessione nella barra in alto.
 * EN: Shows the connection state in the top bar.
 */
function setConn(key, kind) {
  conn.key = key;
  conn.kind = kind;
  const text = $('conn-text');
  text.dataset.i18n = key;
  text.textContent = t(key);
  setDot('conn-dot', kind, kind === 'ok');
}

/**
 * IT: Descrive l'uscita attiva per la barra arancione; null se tutto è spento.
 * EN: Describes the active output for the orange bar; null when everything is off.
 */
function describeOutput(out) {
  if (out.sim) return t('out_sim');
  if (out.sink) return t('out_sink', { v: fmt(out.value, 3) });
  if (out.mode === 1) return t('out_v', { v: fmt(out.value, 3) });
  if (out.mode >= 2) return t('out_i', { v: fmt(out.value, 3) });
  return null;
}

/**
 * IT: Aggiorna la barra "uscita attiva" (se presente nella pagina).
 * EN: Updates the "active output" bar (if present on the page).
 */
function renderBanner(out) {
  const banner = $('banner');
  if (!banner) return;
  const text = describeOutput(out);
  banner.hidden = text === null;
  if (text) {
    $('banner-text').textContent = text;
    $('banner-fault').hidden = !out.fault;
  }
}

/**
 * IT: Spegne tutte le uscite e restituisce il nuovo stato (null se il comando fallisce).
 * EN: Switches all outputs off and returns the new state (null if the command fails).
 */
async function switchOff() {
  try {
    return await request(API.off, { method: 'POST' });
  } catch (e) {
    setConn('cmd_fail', 'err');
    return null;
  }
}

/**
 * IT: Avvia il ciclo di aggiornamento: chiama onState(stato) ogni secondo, gestisce la connessione.
 * EN: Starts the refresh loop: calls onState(state) every second, handles the connection state.
 */
function startPolling(onState) {
  let failures = 0;
  const tick = async () => {
    try {
      onState(await request(API.state));
      failures = 0;
      setConn('conn_ok', 'ok');
    } catch (e) {
      failures += 1;
      if (failures >= 2) setConn('conn_lost', 'err');
    } finally {
      setTimeout(tick, POLL_MS);
    }
  };
  tick();
}

/**
 * IT: Prepara la barra in alto (lingua, tema, pulsante di spegnimento); onLang viene chiamata al cambio lingua.
 * EN: Sets up the top bar (language, theme, switch-off button); onLang is called on language change.
 */
function initChrome(onLang, onState) {
  if (typeof buildNav === 'function') buildNav();   // IT: menu laterale (nav.js) / EN: side menu (nav.js)
  applyI18n();
  document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  $('btn-theme').addEventListener('click', toggleTheme);
  document.addEventListener('langchange', () => {
    setConn(conn.key, conn.kind);
    if (onLang) onLang();
  });
  const off = $('btn-off');
  if (off) {
    off.addEventListener('click', async () => {
      off.disabled = true;
      const s = await switchOff();
      if (s && onState) onState(s);
      off.disabled = false;
    });
  }
}

/**
 * IT: Messaggio per un errore di PIN dal firmware ('pin', 'locked', 'format'). EN: Message for a firmware PIN error ('pin', 'locked', 'format').
 */
function pinErr(j) {
  if (j.err === 'locked') return t('pin_locked', { s: j.wait || 60 });
  if (j.err === 'format') return t('pin_format');
  return t('pin_bad');
}

/**
 * IT: Chiede il PIN di servizio in una finestra e lo verifica sullo strumento; restituisce il PIN o null (annullato).
 * EN: Asks for the service PIN in a dialog and verifies it on the instrument; returns the PIN or null (cancelled).
 */
function askPin(titleKey) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
        <h3><svg class="icon"><use href="img/icons.svg#ic-lock"/></svg>${t('pin_title')}</h3>
        <p class="hint">${t(titleKey)}</p>
        <div class="field pin-field"><input id="pin-in" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••"></div>
        <div id="pin-err" class="err-text"></div>
        <div class="actions"><button id="pin-ok" class="btn btn-lg btn-primary" type="button">${t('pin_ok')}</button>
        <button id="pin-no" class="btn btn-lg" type="button">${t('btn_cancel')}</button></div>
      </div>`;
    document.body.appendChild(box);
    const input = box.querySelector('#pin-in');
    const done = (v) => { box.remove(); resolve(v); };
    const confirm = async () => {
      const pin = input.value.trim();
      if (!pin) return;
      box.querySelector('#pin-ok').disabled = true;
      try {
        const res = await fetch(`/api/pin/verify?pin=${encodeURIComponent(pin)}`, { method: 'POST', cache: 'no-store' });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.ok) return done(pin);
        box.querySelector('#pin-err').textContent = pinErr(j);
        input.value = '';
        input.focus();
      } catch (e) {
        box.querySelector('#pin-err').textContent = t('cmd_fail');
      }
      box.querySelector('#pin-ok').disabled = false;
    };
    box.querySelector('#pin-ok').addEventListener('click', confirm);
    box.querySelector('#pin-no').addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') done(null); });
    box.addEventListener('click', (e) => { if (e.target === box) done(null); });
    setTimeout(() => input.focus(), 50);
  });
}
