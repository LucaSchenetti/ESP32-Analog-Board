/*
  IO Tester — pagina "Diagnostica" / "Diagnostics" page
  IT: Stato di alimentazione, AD5412, ADS1220, ESP32-S3 e WiFi da /api/state; tensione su GPIO1 da /api/power;
      test SPI di AD5412 e ADS1220; antenna (potenza TX, segnale dei dispositivi con storico di 30 s,
      reti vicine) da /api/antenna; prova di LED RGB e cicalino.
  EN: Supply, AD5412, ADS1220, ESP32-S3 and WiFi state from /api/state; GPIO1 voltage from /api/power;
      AD5412 and ADS1220 SPI tests; antenna (TX power, device signal with 30 s history, nearby
      networks) from /api/antenna; RGB LED and buzzer test.
  Richiede / requires: theme.js, i18n.js, common.js.
*/
'use strict';

const VUSB_MIN = 4.75;      // IT: minimo USB 2.0 per VBUS / EN: USB 2.0 VBUS minimum
const rssiHist = {};        // IT: ultimi 30 RSSI per MAC / EN: last 30 RSSI per MAC
let lastState = null;
let lastAnt = null;
let stopSweep = false;

/**
 * IT: Esadecimale a 4 cifre. EN: 4-digit hexadecimal.
 */
function hex4(x) {
  return `0x${x.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * IT: Giudizio indicativo di un RSSI (soglie empiriche, non da datasheet). EN: Indicative RSSI rating (empirical thresholds, not from a datasheet).
 */
function rssiRate(r) {
  if (r >= -50) return { key: 'rssi_exc', kind: 'ok' };
  if (r >= -67) return { key: 'rssi_good', kind: 'ok' };
  if (r >= -75) return { key: 'rssi_poor', kind: 'warn' };
  return { key: 'rssi_bad', kind: 'err' };
}

/**
 * IT: Aggiorna tutti i pannelli con lo stato di /api/state. EN: Updates every panel with the /api/state data.
 */
function render(s) {
  lastState = s;

  // Alimentazione / Supply
  setRow('src', s.ext24 ? t('v_field') : t('v_usb'), 'ok');
  const low = !s.ext24 && s.vusb < VUSB_MIN;
  setRow('vusb', s.ext5 ? `${fmt(s.vusb, 2)} V${low ? ` · ${t('v_low')}` : ''}` : t('v_absent'), s.ext5 ? (low ? 'warn' : 'ok') : '');
  setRow('24', s.ext24 ? t('v_present') : t('v_absent'), s.ext24 ? 'ok' : '');
  setRow('5', s.ext5 ? t('v_present') : t('v_absent'), s.ext5 ? 'ok' : '');

  // Uscita AD5412 / AD5412 output
  const on = s.out.sink || s.out.mode !== 0;
  setRow('out', on ? t(s.out.sink ? 'mode_sink' : s.out.mode === 1 ? 'mode_v' : 'mode_i') : t('v_off'), on ? 'warn' : '');
  setRow('dact', s.out.selftest ? t('v_ok') : t('v_failed'), s.out.selftest ? 'ok' : 'err');
  setRow('fault', s.out.fault ? t('v_yes') : t('v_no'), s.out.fault ? 'err' : 'ok');
  const ot = (s.out.status & 1) === 1;
  const iof = (s.out.status & 4) === 4;
  setRow('ot', ot ? t('v_yes') : t('v_no'), ot ? 'err' : 'ok');
  setRow('iof', iof ? t('v_yes') : t('v_no'), iof ? 'err' : 'ok');
  setRow('ctrl', hex4(s.out.ctrl));
  setRow('sts', hex4(s.out.status));

  // Ingresso ADS1220 / ADS1220 input
  setRow('adct', s.in.selftest ? t('v_ok') : t('v_failed'), s.in.selftest ? 'ok' : 'err');
  setRow('adctemp', s.temp === null ? '–' : `${fmt(s.temp, 2)} °C`);
  setRow('adcn', s.in.n.toLocaleString(locale()));
  setRow('adce', String(s.in.err), s.in.err ? 'warn' : 'ok');
  setRow('codev', String(s.in.code_v));
  setRow('codei', String(s.in.code_i));

  // ESP32-S3
  setRow('esptemp', s.esp.temp === null ? '–' : `${fmt(s.esp.temp, 1)} °C`);
  setRow('heap', `${fmt(s.esp.heap / 1024, 0)} KB`);
  setRow('heapmin', `${fmt(s.esp.heap_min / 1024, 0)} KB`);
  setRow('up', fmtDuration(s.uptime));
  const badReset = ['panic', 'wdt', 'brownout'].includes(s.esp.reset);
  setRow('rst', t(`rst_${s.esp.reset}`), badReset ? 'warn' : 'ok');
  setRow('cpu', `${s.esp.cpu} MHz`);
  setRow('fwv', s.fw);

  // WiFi
  setRow('ssid', s.wifi.ssid);
  setRow('ch', String(s.wifi.ch));
  setRow('tx', `${fmt(s.wifi.tx, 1)} dBm`);

  // Stato generale / Overall state
  const bad = !s.out.selftest || !s.in.selftest || s.out.fault || ot || badReset;
  const warn = low || s.in.err > 0;
  const chip = $('state');
  chip.className = `state-chip${bad ? ' err' : warn ? ' other' : ' on'}`;
  chip.dataset.i18n = bad ? 'dg_st_bad' : warn ? 'dg_st_warn' : 'dg_st_ok';
  chip.textContent = t(chip.dataset.i18n);

  $('fw').textContent = s.fw;
  renderBanner(s.out);
}

/**
 * IT: Aggiorna antenna (dispositivi con storico di 30 s, reti vicine) e tensione su GPIO1.
 * EN: Updates antenna (devices with 30 s history, nearby networks) and GPIO1 voltage.
 */
async function pollExtra() {
  try {
    const [a, p] = await Promise.all([request('/api/antenna'), request('/api/power')]);
    lastAnt = a;
    setRow('pin', `${p.pin_mv} mV`);
    renderAntenna(a, true);
  } catch (e) { /* IT: riprova al giro successivo / EN: retry next round */ }
  setTimeout(pollExtra, 2000);
}

/**
 * IT: Disegna le tabelle dei dispositivi e delle reti; add = aggiunge i nuovi RSSI allo storico.
 * EN: Draws the device and network tables; add = adds the new RSSI values to the history.
 */
function renderAntenna(a, add) {
  const rows = a.stations.map((st) => {
    const h = (rssiHist[st.mac] = rssiHist[st.mac] || []);
    if (add) {
      h.push(st.rssi);
      if (h.length > 30) h.shift();
    }
    const avg = h.reduce((x, y) => x + y, 0) / h.length;
    const r = rssiRate(avg);
    return `<tr><td>${st.mac}</td><td>${st.rssi} dBm</td><td>${Math.min(...h)} / ${fmt(avg, 1)} / ${Math.max(...h)}</td><td><span class="zone ${r.kind}">${t(r.key)}</span></td></tr>`;
  });
  $('sta').innerHTML = rows.join('') || `<tr><td colspan="4">${t('dg_noclient')}</td></tr>`;
  $('nets').innerHTML = a.scan.map((e) => {
    const w = Math.max(0, Math.min(100, (e.rssi + 100) * 2));
    return `<tr><td>${e.ssid || `<i>${t('dg_hidden')}</i>`}</td><td>${e.ch}</td><td>${e.rssi} dBm</td><td><span class="sig"><i style="width:${w}%"></i></span></td></tr>`;
  }).join('');
  $('scan').disabled = a.scanning;
  $('scan-age').textContent = a.scanning ? t('dg_scanning') : a.scan_age_s >= 0 ? t('dg_scan_age', { s: a.scan_age_s, n: a.scan.length }) : '';
}

/**
 * IT: Esegue un test SPI (dac o adc) e ne mostra i passi. EN: Runs an SPI test (dac or adc) and shows its steps.
 */
async function runTest(p) {
  if (p === 'dac' && lastState && (lastState.out.sink || lastState.out.mode !== 0) && !window.confirm(t('dg_dac_confirm'))) return;
  const btn = $(`${p}-run`);
  btn.disabled = true;
  try {
    const r = await request(`/api/${p}/test`, { method: 'POST' });
    const tab = $(`${p}-tab`);
    tab.querySelector('tbody').innerHTML = r.steps.map((x) =>
      `<tr><td>${x.name}</td><td>${x.expect}</td><td>${x.read}</td><td><span class="dot ${x.ok ? 'ok' : 'err'}"></span></td></tr>`).join('');
    tab.hidden = false;
    const res = $(`${p}-res`);
    res.hidden = false;
    res.className = `zone ${r.ok ? 'ok' : 'err'}`;
    res.textContent = t(r.ok ? 'dg_pass' : 'dg_fail');
    let info = '';
    if (p === 'dac') info = `FAULT: ${t(r.fault ? 'v_yes' : 'v_no')}`;
    else info = r.drdy ? t('dg_adc_drdy', { tc: fmt(r.temp_c, 2), ms: r.conv_ms }) : t('dg_adc_nodrdy');
    $(`${p}-info`).textContent = info + (r.hint ? ` · ${r.hint}` : '');
  } catch (e) {
    setConn('cmd_fail', 'err');
  } finally {
    btn.disabled = false;
  }
}

/**
 * IT: Comando al cicalino (f = 0 spegne). EN: Buzzer command (f = 0 switches off).
 */
function buzz(f, ms) {
  return fetch(`/api/buzzer?f=${f}${ms ? `&ms=${ms}` : ''}`, { method: 'POST' }).catch(() => setConn('cmd_fail', 'err'));
}

document.addEventListener('DOMContentLoaded', () => {
  initChrome(() => {
    if (lastState) render(lastState);
    if (lastAnt) renderAntenna(lastAnt, false);
  }, render);

  $('dac-run').addEventListener('click', () => runTest('dac'));
  $('adc-run').addEventListener('click', () => runTest('adc'));
  $('tx-apply').addEventListener('click', async () => {
    await fetch(`/api/txpower?dbm=${$('tx-sel').value}`, { method: 'POST' }).catch(() => setConn('cmd_fail', 'err'));
  });
  $('scan').addEventListener('click', async () => {
    $('scan').disabled = true;
    await fetch('/api/scan', { method: 'POST' }).catch(() => setConn('cmd_fail', 'err'));
  });
  document.querySelectorAll('[data-rgb]').forEach((b) => b.addEventListener('click', () => {
    const [r, g, bl] = b.dataset.rgb.split(',');
    fetch(`/api/led?r=${r}&g=${g}&b=${bl}`, { method: 'POST' }).catch(() => setConn('cmd_fail', 'err'));
  }));
  $('bz-beep').addEventListener('click', () => buzz(Number($('bz-f').value) || 4000, 300));
  $('bz-stop').addEventListener('click', () => { stopSweep = true; buzz(0); $('bz-now').textContent = ''; });
  $('bz-sweep').addEventListener('click', async () => {
    // IT: 2–6 kHz a passi di 250 Hz per trovare la risonanza (KLJ-4020: 4 kHz nominali)
    // EN: 2–6 kHz in 250 Hz steps to find the resonance (KLJ-4020: 4 kHz nominal)
    stopSweep = false;
    for (let f = 2000; f <= 6000 && !stopSweep; f += 250) {
      $('bz-now').textContent = `${f} Hz`;
      await buzz(f, 250);
      await new Promise((r) => setTimeout(r, 300));
    }
    $('bz-now').textContent = '';
  });

  startPolling(render);
  pollExtra();
});
