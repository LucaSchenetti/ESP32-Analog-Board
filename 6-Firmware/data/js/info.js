/*
  IO Tester — pagina "Info app" / "App info" page
  IT: Informazioni sullo strumento da /api/update/info; aggiornamento del firmware e dell'interfaccia web
      dal browser (controllo del file, invio con avanzamento, riavvio, attesa del ricollegamento);
      tabella e copia dei coefficienti di calibrazione; cancellazione della NVS con conferma scritta.
  EN: Instrument information from /api/update/info; firmware and web interface update from the browser
      (file check, upload with progress, restart, wait for reconnection); calibration coefficient table
      and copy; NVS erase with typed confirmation.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

const ESP_MAGIC = 0xE9;     // IT: primo byte di un'immagine ESP / EN: first byte of an ESP image
const CHIP_S3 = 9;          // IT: chip_id ESP32-S3 nell'intestazione estesa / EN: ESP32-S3 chip_id in the extended header
const CHANNELS = ['vin', 'iin', 'vout', 'iout', 'sink'];
const SUB = { vin: 'mV', iin: 'µA', vout: 'mV', iout: 'µA', sink: 'µA' };

let info = null;
let lastState = null;
let busy = false;
const picked = { fw: null, fs: null };

/**
 * IT: Dimensione in KB con un decimale. EN: Size in KB with one decimal.
 */
function kb(bytes) {
  return fmt(bytes / 1024, 1);
}

/**
 * IT: Data di compilazione ("Oct  1 2026 19:20:11", da __DATE__ __TIME__) nella lingua scelta.
 * EN: Build date ("Oct  1 2026 19:20:11", from __DATE__ __TIME__) in the chosen language.
 */
function fmtBuilt(s) {
  const d = new Date(s.replace(/\s+/g, ' '));
  return Number.isNaN(d.getTime()) ? s
    : `${d.toLocaleDateString(locale())} ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * IT: Scrive le righe di informazione di un pannello di aggiornamento. EN: Writes the info rows of an update panel.
 */
function panelRows(id, rows) {
  $(`${id}-rows`).innerHTML = rows.map(([k, v]) =>
    `<div class="row"><span class="dot"></span><span class="k">${t(k)}</span><span class="v">${v}</span></div>`).join('');
}

/**
 * IT: Legge /api/update/info e aggiorna il riquadro dell'app e i due pannelli. EN: Reads /api/update/info and updates the app box and both panels.
 */
async function loadInfo() {
  try {
    info = await request('/api/update/info');
  } catch (e) {
    return false;
  }
  setRow('afw', info.fw);
  setRow('abuilt', fmtBuilt(info.built));
  setRow('aidf', info.idf);
  setRow('arun', info.running);
  renderInfo();
  return true;
}

/**
 * IT: Righe dei pannelli firmware e interfaccia (anche al cambio lingua). EN: Firmware and interface panel rows (also on language change).
 */
function renderInfo() {
  if (!info) return;
  panelRows('fw', [
    ['up_cur', info.fw],
    ['up_slot', `${info.running} → ${info.next}`],
    ['up_size', `${kb(info.sketch)} KB`],
    ['up_max', `${kb(info.app_max)} KB`],
  ]);
  panelRows('fs', [
    ['up_fs_used', `${kb(info.fs_used)} / ${kb(info.fs_size)} KB`],
  ]);
  setRow('nvs', `${info.nvs_used} / ${info.nvs_total}`);
  setRow('pin', info.pin_default ? t('pin_is_default') : t('pin_is_custom'), info.pin_default ? 'warn' : 'ok');
}

/**
 * IT: Controlla il file scelto: estensione, intestazione ESP, chip, dimensione. Restituisce '' se valido, altrimenti il messaggio.
 * EN: Checks the chosen file: extension, ESP header, chip, size. Returns '' if valid, otherwise the message.
 */
async function checkFile(target, f) {
  if (!/\.bin$/i.test(f.name)) return t('up_e_ext');
  if (f.size === 0) return t('up_e_empty');
  const head = new Uint8Array(await f.slice(0, 16).arrayBuffer());
  if (target === 'fw') {
    if (head[0] !== ESP_MAGIC) return t('up_e_magic');
    const chip = head[12] | (head[13] << 8);
    if (chip !== CHIP_S3) return t('up_e_chip', { id: chip });
    if (info && f.size > info.app_max) return t('up_e_big', { s: kb(f.size), m: kb(info.app_max) });
  } else {
    if (head[0] === ESP_MAGIC) return t('up_e_isfw');
    if (info && f.size > info.fs_size) return t('up_e_big', { s: kb(f.size), m: kb(info.fs_size) });
  }
  return '';
}

/**
 * IT: Mostra un messaggio nel pannello (kind: 'err', 'warn', 'ok'); testo vuoto = nascosto.
 * EN: Shows a message in the panel (kind: 'err', 'warn', 'ok'); empty text = hidden.
 */
function panelMsg(target, text, kind) {
  const m = $(`${target}-msg`);
  m.hidden = !text;
  m.textContent = text;
  m.className = `alert${kind === 'ok' ? ' ok' : kind === 'warn' ? ' warn' : ''}`;
}

/**
 * IT: Scelta di un file: controllo e abilitazione del pulsante. EN: File chosen: check and enable the button.
 */
async function onPick(target) {
  const f = $(`${target}-file`).files[0];
  picked[target] = null;
  $(`${target}-go`).disabled = true;
  if (!f) return;
  $(`${target}-name`).textContent = f.name;
  delete $(`${target}-name`).dataset.i18n;
  const err = await checkFile(target, f);
  if (err) {
    panelMsg(target, err, 'err');
    return;
  }
  picked[target] = f;
  panelMsg(target, t('up_ok_file', { s: kb(f.size) }), 'ok');
  $(`${target}-go`).disabled = busy;
}

/**
 * IT: Avanzamento: percentuale e testo. EN: Progress: percentage and text.
 */
function progress(target, pct, text, err = false) {
  $(`${target}-prog`).hidden = false;
  const bar = $(`${target}-bar`);
  bar.style.width = `${pct}%`;
  bar.classList.toggle('err', err);
  $(`${target}-step`).innerHTML = `${err ? '' : '<span class="spinner"></span>'}${text}`;
}

/**
 * IT: Attende che lo strumento risponda dopo il riavvio (massimo 60 s); restituisce le nuove informazioni o null.
 * EN: Waits for the instrument to answer after restart (60 s maximum); returns the new information or null.
 */
async function waitRestart(target) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() - t0 < 60000) {
    progress(target, 100, t('up_wait', { s: Math.round((Date.now() - t0) / 1000) }));
    try {
      return await request('/api/update/info');
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

/**
 * IT: Blocca o sblocca i comandi durante un'operazione. EN: Locks or unlocks the controls during an operation.
 */
function setBusy(on) {
  busy = on;
  ['fw', 'fs'].forEach((p) => { $(`${p}-go`).disabled = on || !picked[p]; $(`${p}-file`).disabled = on; });
  $('nvs-erase').disabled = on || $('nvs-confirm').value.trim().toUpperCase() !== 'ELIMINA';
  const chip = $('state');
  chip.className = `state-chip${on ? ' other' : ' on'}`;
  chip.dataset.i18n = on ? 'up_st_busy' : 'up_st_ready';
  chip.textContent = t(chip.dataset.i18n);
}

/**
 * IT: Cambio del PIN di servizio dal pannello Sicurezza. EN: Service PIN change from the Security panel.
 */
async function changePin() {
  const oldP = $('pin-old').value.trim();
  const newP = $('pin-new').value.trim();
  const msg = $('pin-msg');
  msg.className = 'hint';
  if (!/^\d{4,8}$/.test(newP)) { msg.textContent = t('pin_format'); msg.className = 'err-text'; return; }
  if (newP !== $('pin-new2').value.trim()) { msg.textContent = t('pin_mismatch'); msg.className = 'err-text'; return; }
  try {
    const res = await fetch(`/api/pin/change?old=${encodeURIComponent(oldP)}&new=${encodeURIComponent(newP)}`, { method: 'POST', cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { msg.textContent = pinErr(j); msg.className = 'err-text'; return; }
    ['pin-old', 'pin-new', 'pin-new2'].forEach((id) => { $(id).value = ''; });
    msg.textContent = t('pin_changed');
    msg.className = 'hint ok-msg';
    loadInfo();
  } catch (e) {
    msg.textContent = t('cmd_fail');
    msg.className = 'err-text';
  }
}

/**
 * IT: Invia il file con XMLHttpRequest (per l'avanzamento), poi attende il riavvio e verifica.
 * EN: Sends the file with XMLHttpRequest (for the progress), then waits for the restart and verifies.
 */
async function upload(target) {
  const f = picked[target];
  if (!f || busy) return;
  const out = lastState && (lastState.out.sink || lastState.out.mode !== 0);
  if (out && !window.confirm(t('up_confirm'))) return;
  const pin = await askPin(target === 'fw' ? 'pin_for_fw' : 'pin_for_fs');
  if (!pin) return;
  setBusy(true);
  panelMsg(target, '', '');
  const fd = new FormData();
  fd.append('file', f, f.name);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/update?target=${target}&pin=${encodeURIComponent(pin)}`);
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const p = Math.round((e.loaded / e.total) * 100);
    progress(target, p * 0.95, p < 100 ? t('up_send', { p }) : t('up_write'));
  };
  xhr.onload = async () => {
    let j = {};
    try { j = JSON.parse(xhr.responseText); } catch (e) { /* IT/EN: risposta non JSON / non-JSON reply */ }
    if (xhr.status !== 200 || !j.ok) {
      const e = j.err === 'pin' || j.err === 'locked' ? pinErr(j) : j.err || `HTTP ${xhr.status}`;
      progress(target, 100, t('up_fail', { e }), true);
      setBusy(false);
      return;
    }
    progress(target, 100, t('up_reboot'));
    const ni = await waitRestart(target);
    if (!ni) {
      progress(target, 100, t('up_timeout'), true);
      setBusy(false);
      return;
    }
    if (target === 'fs') {
      progress(target, 100, t('up_done_fs'));
      setTimeout(() => location.reload(), 1200);
      return;
    }
    await loadInfo();
    $(`${target}-prog`).hidden = true;
    panelMsg(target, t('up_done_fw', { v: ni.fw }), 'ok');
    setBusy(false);
  };
  xhr.onerror = () => {
    progress(target, 100, t('up_fail', { e: t('conn_lost') }), true);
    setBusy(false);
  };
  progress(target, 0, t('up_send', { p: 0 }));
  xhr.send(fd);
}

/**
 * IT: Tabella dei coefficienti di calibrazione dallo stato. EN: Calibration coefficient table from the state.
 */
function renderCal(s) {
  $('cal-rows').innerHTML = CHANNELS.map((ch) => {
    const c = s.cal[ch];
    if (!c || !c.valid) return `<tr><td>${t(`ch_${ch}`)}</td><td>–</td><td>–</td><td>${t('v_none')}</td></tr>`;
    const o = c.offset * 1000;
    return `<tr><td>${t(`ch_${ch}`)}</td><td>${fmt(c.gain, 6)}</td><td>${o >= 0 ? '+' : ''}${fmt(o, 1)} ${SUB[ch]}</td><td>${fmtDate(c.date)}</td></tr>`;
  }).join('');
}

/**
 * IT: Copia dei coefficienti in JSON: negli appunti (execCommand, funziona anche in HTTP e nell'app) e come file.
 * EN: Coefficient copy as JSON: to the clipboard (execCommand, works on HTTP and in the app too) and as a file.
 */
function copyCal() {
  if (!lastState) return;
  const data = { instrument: 'IO Tester', fw: lastState.fw, exported: new Date().toISOString(), calibration: {} };
  CHANNELS.forEach((ch) => { data.calibration[ch] = lastState.cal[ch]; });
  const text = JSON.stringify(data, null, 2);
  const ta = $('cal-json');
  ta.hidden = false;
  ta.value = text;
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  $('nvs-msg').textContent = t(ok ? 'up_copied' : 'up_copy_fail');
  const a = $('cal-dl');
  a.hidden = false;
  a.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
  a.download = `iotester-calibrazione-${new Date().toISOString().slice(0, 10)}.json`;
}

/**
 * IT: Cancella la NVS dopo doppia conferma e attende il riavvio. EN: Erases the NVS after double confirmation and waits for the restart.
 */
async function eraseNvs() {
  if (busy || $('nvs-confirm').value.trim().toUpperCase() !== 'ELIMINA') return;
  if (!window.confirm(t('up_erase_confirm'))) return;
  const pin = await askPin('pin_for_nvs');
  if (!pin) return;
  setBusy(true);
  $('nvs-msg').textContent = t('up_reboot');
  try {
    const res = await fetch(`/api/nvs/erase?confirm=ELIMINA&pin=${encodeURIComponent(pin)}`, { method: 'POST', cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.err ? pinErr(j) : t('cmd_fail'));
  } catch (e) {
    $('nvs-msg').textContent = t('up_fail', { e: e.message || t('cmd_fail') });
    setBusy(false);
    return;
  }
  await new Promise((r) => setTimeout(r, 3000));
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    try {
      await request('/api/update/info');
      $('nvs-msg').textContent = t('up_erased');
      $('nvs-confirm').value = '';
      await loadInfo();
      setBusy(false);
      return;
    } catch (e) {
      $('nvs-msg').textContent = t('up_wait', { s: Math.round((Date.now() - t0) / 1000) });
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  $('nvs-msg').textContent = t('up_timeout');
  setBusy(false);
}

/**
 * IT: Nuovo stato: coefficienti, barra uscita attiva, versione. EN: New state: coefficients, active-output bar, version.
 */
function onState(s) {
  lastState = s;
  renderCal(s);
  renderBanner(s.out);
  $('fw').textContent = s.fw;
}

document.addEventListener('DOMContentLoaded', () => {
  initChrome(() => {
    renderInfo();
    if (info) setRow('abuilt', fmtBuilt(info.built));
    if (lastState) renderCal(lastState);
    setBusy(busy);
  }, onState);
  setBusy(false);
  ['fw', 'fs'].forEach((p) => {
    $(`${p}-file`).addEventListener('change', () => onPick(p));
    $(`${p}-go`).addEventListener('click', () => upload(p));
  });
  $('nvs-copy').addEventListener('click', copyCal);
  $('nvs-confirm').addEventListener('input', () => setBusy(busy));
  $('nvs-erase').addEventListener('click', eraseNvs);
  $('pin-change').addEventListener('click', changePin);
  loadInfo();
  startPolling(onState);
});
