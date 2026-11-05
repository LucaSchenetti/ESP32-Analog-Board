/*
  IO Tester — pagina principale / home page
  IT: Legge /api/state ogni secondo e mostra: stato dello strumento in una riga (pronto / da controllare,
      con l'elenco dei problemi), alimentazione, uscite, calibrazione e WiFi in breve, ingressi in tempo
      reale con zona NAMUR. I dettagli tecnici sono nella pagina Diagnostica.
  EN: Polls /api/state every second and shows: instrument state in one line (ready / to check, with the
      list of problems), supply, outputs, calibration and WiFi in short, live inputs with NAMUR zone.
      Technical details are on the Diagnostics page.
*/
'use strict';

const VUSB_MIN = 4.75;      // IT: minimo USB 2.0 per VBUS / EN: USB 2.0 VBUS minimum
let lastState = null;

/**
 * IT: Elenco dei problemi da segnalare, con gravità ('err' o 'warn'). EN: List of problems to report, with severity ('err' or 'warn').
 */
function issues(s) {
  const list = [];
  if (!s.out.selftest) list.push({ k: 'is_dac', kind: 'err' });
  if (!s.in.selftest) list.push({ k: 'is_adc', kind: 'err' });
  if (s.out.fault) list.push({ k: 'is_fault', kind: 'err' });
  if ((s.out.status & 1) === 1) list.push({ k: 'is_ot', kind: 'err' });
  if (['panic', 'wdt', 'brownout'].includes(s.esp.reset)) list.push({ k: 'is_reset', p: { r: t(`rst_${s.esp.reset}`) }, kind: 'warn' });
  if (!s.ext24 && s.ext5 && s.vusb < VUSB_MIN) list.push({ k: 'is_usb', p: { v: fmt(s.vusb, 2) }, kind: 'warn' });
  if (s.in.err > 0) list.push({ k: 'is_adcerr', p: { n: s.in.err }, kind: 'warn' });
  if (s.wifi.rssi !== null && s.wifi.rssi < -75) list.push({ k: 'is_rssi', p: { r: s.wifi.rssi }, kind: 'warn' });
  return list;
}

/**
 * IT: Riga di stato in alto: icona, titolo, sottotitolo e le quattro voci brevi.
 * EN: Top state line: icon, title, subtitle and the four short items.
 */
function renderHero(s) {
  const list = issues(s);
  const bad = list.some((x) => x.kind === 'err');
  const kind = bad ? 'err' : list.length ? 'warn' : 'ok';
  $('hero-ico').className = `hero-ico ${kind}`;
  const title = $('hero-title');
  title.dataset.i18n = bad ? 'hm_err' : list.length ? 'hm_check' : 'hm_ready';
  title.textContent = t(title.dataset.i18n);
  $('hero-sub').textContent = list.length
    ? list.slice(0, 3).map((x) => t(x.k, x.p)).join(' · ')
    : t('hm_ready_sub');

  // Alimentazione / Supply
  const low = !s.ext24 && s.vusb < VUSB_MIN;
  // IT: sorgente esplicita (USB / 24 V di campo) e, sotto, la tensione USB o la presenza di entrambe
  // EN: explicit source (USB / 24 V field) and, below, the USB voltage or the presence of both
  setRow('hpow', s.ext24 ? t('v_field') : t('v_usb'), low ? 'warn' : 'ok');
  $('hpow-sub').textContent = s.ext24
    ? (s.ext5 ? t('hm_pow_both', { v: fmt(s.vusb, 2) }) : t('hm_pow_field'))
    : `${fmt(s.vusb, 2)} V${low ? ` · ${t('v_low')}` : ''}`;

  // Uscite / Outputs
  const o = s.out;
  const on = o.sink || o.mode !== 0;
  const outTxt = !on ? t('hm_out_off')
    : o.sim ? t('fn_pid')
    : o.sink ? `${t('fn_sim')} ${fmt(o.value, 3)} mA`
      : o.mode === 1 ? `${fmt(o.value, 3)} V` : `${fmt(o.value, 3)} mA`;
  setRow('hout', outTxt, on ? (o.fault ? 'err' : 'warn') : 'ok');

  // Calibrazione / Calibration
  const n = Object.values(s.cal).filter((c) => c.valid).length;
  setRow('hcal', t('hm_cal_n', { n }), n === 5 ? 'ok' : 'warn');
  $('fn-cal-sub').textContent = t('hm_cal_sub', { n });

  // WiFi
  const r = s.wifi.rssi;
  setRow('hwifi', r === null ? '–' : `${r} dBm`, r === null ? '' : r >= -67 ? 'ok' : r >= -75 ? 'warn' : 'err');
}

/**
 * IT: Lettura d'ingresso: valore, min…max, segnalazione di fuori scala o valore negativo.
 * EN: Input reading: value, min…max, over-range or negative flag.
 */
function renderInput(key, value, min, max, sat) {
  $(`${key}-in`).textContent = sat ? '– – –' : fmt(value, 4);
  $(`${key}-range`).textContent = t('range_minmax', { min: fmt(min, 4), max: fmt(max, 4) });
  const flag = $(`${key}-flag`);
  const neg = value < -0.05;
  if (sat) flag.textContent = t('flag_over');
  else if (neg) flag.textContent = t('flag_neg');
  flag.hidden = !(sat || neg);
}

/**
 * IT: Zona NAMUR NE 43 della corrente in ingresso (nascosta sotto 50 µA: nessun segnale).
 * EN: NAMUR NE 43 zone of the input current (hidden below 50 µA: no signal).
 */
function renderZone(ma, sat) {
  const z = $('i-zone');
  if (sat || Math.abs(ma) < 0.05) {
    z.hidden = true;
    return;
  }
  const [key, kind] = ma < 3.6 ? ['nm_low_fail', 'err'] : ma < 3.8 ? ['nm_under', 'warn']
    : ma <= 20.5 ? ['nm_ok', 'ok'] : ma < 21 ? ['nm_over', 'warn'] : ['nm_high_fail', 'err'];
  z.hidden = false;
  z.className = `zone ${kind}`;
  z.textContent = t(key);
}

/**
 * IT: Aggiorna tutta la pagina con lo stato ricevuto. EN: Updates the whole page with the received state.
 */
function render(s) {
  lastState = s;
  renderHero(s);
  renderInput('v', s.in.v, s.in.v_min, s.in.v_max, s.in.sat_v);
  renderInput('i', s.in.i, s.in.i_min, s.in.i_max, s.in.sat_i);
  renderZone(s.in.i, s.in.sat_i);
  renderBanner(s.out);
  $('fw').textContent = s.fw;
}

document.addEventListener('DOMContentLoaded', () => {
  initChrome(() => { if (lastState) render(lastState); }, render);
  startPolling(render);
});
