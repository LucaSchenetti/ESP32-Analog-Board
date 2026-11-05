/*
  IO Tester — pagina "Misura corrente 4 fili" / "Measure 4-wire current" page
  IT: Configurazione dell'ingresso 4–20 mA da sorgente attiva (P2.4 mA+ / P2.3 mA−); la logica è in measure-page.js.
  EN: Configuration of the 4–20 mA input from an active source (P2.4 mA+ / P2.3 mA−); the logic is in measure-page.js.
*/
'use strict';

initMeasurePage({
  keys: { val: 'i', min: 'i_min', max: 'i_max', nom: 'i_nom', code: 'code_i', sat: 'sat_i' },
  unit: 'mA',
  dec: 4,
  lo: 4,
  hi: 20,
  ticks: [0, 4, 8, 12, 16, 20, 24],
  calKey: 'iin',
  noSignal: 0.05,                  // IT: sotto 50 µA = nessun segnale / EN: below 50 µA = no signal
  namur: true,
  // IT: confronto con "Genera corrente" in loopback (P1.3 mA+ → P2.4 mA+): verde ≤ 20 µA, arancio ≤ 50 µA
  // EN: comparison with "Generate current" in loopback (P1.3 mA+ → P2.4 mA+): green ≤ 20 µA, amber ≤ 50 µA
  ranges: [
    { id: '4-20', label: '4–20 mA', lo: 4, hi: 20, namur: true },
    { id: '0-20', label: '0–20 mA', lo: 0, hi: 20, namur: false },
  ],
  scaleKey: 'iotester.scale.meas-i4',
  cmp: { port: 'P1.3 mA+', unit: 'µA', scale: 1000, ok: 20, warn: 50, match: (o) => (o.mode === 2 || o.mode === 3) && !o.sink },
});
