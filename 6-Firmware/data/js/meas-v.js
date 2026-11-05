/*
  IO Tester — pagina "Misura tensione" / "Measure voltage" page
  IT: Configurazione dell'ingresso 0–10 V (P2.2 V+ / P2.1 V−); la logica è in measure-page.js.
  EN: Configuration of the 0–10 V input (P2.2 V+ / P2.1 V−); the logic is in measure-page.js.
*/
'use strict';

initMeasurePage({
  keys: { val: 'v', min: 'v_min', max: 'v_max', nom: 'v_nom', code: 'code_v', sat: 'sat_v' },
  unit: 'V',
  dec: 4,
  lo: 0,
  hi: 10,
  ticks: [0, 2, 4, 6, 8, 10, 12],
  calKey: 'vin',
  noSignal: 0.02,                  // IT: sotto 20 mV = nessun segnale / EN: below 20 mV = no signal
  namur: false,
  // IT: confronto con "Genera tensione" in loopback (P1.4 V+ → P2.2 V+): verde ≤ 10 mV, arancio ≤ 30 mV
  // EN: comparison with "Generate voltage" in loopback (P1.4 V+ → P2.2 V+): green ≤ 10 mV, amber ≤ 30 mV
  ranges: [{ id: '0-10', label: '0–10 V', lo: 0, hi: 10 }],
  scaleKey: 'iotester.scale.meas-v',
  cmp: { port: 'P1.4 V+', unit: 'mV', scale: 1000, ok: 10, warn: 30, match: (o) => o.mode === 1 && !o.sink },
});
