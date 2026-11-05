/*
  IO Tester — pagina "Misura corrente 2 fili" / "Measure 2-wire current" page
  IT: Configurazione dell'ingresso 4–20 mA con trasmettitore alimentato da P2.5 L+ (corrente su P2.4 mA+);
      la logica è in measure-page.js.
  EN: Configuration of the 4–20 mA input with a transmitter powered from P2.5 L+ (current on P2.4 mA+);
      the logic is in measure-page.js.
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
  // IT: confronto con "Simula trasmettitore" in loopback (P2.5 L+ → P1.2 SIM+, P1.1 COM → P2.4 mA+): verde ≤ 40 µA, arancio ≤ 80 µA
  // EN: comparison with "Simulate transmitter" in loopback (P2.5 L+ → P1.2 SIM+, P1.1 COM → P2.4 mA+): green ≤ 40 µA, amber ≤ 80 µA
  // IT: 2 fili: solo 4–20 mA (sotto 4 mA il trasmettitore non si alimenta) / EN: 2-wire: 4–20 mA only (below 4 mA the transmitter is not powered)
  ranges: [{ id: '4-20', label: '4–20 mA', lo: 4, hi: 20, namur: true }],
  scaleKey: 'iotester.scale.meas-i2',
  cmp: { port: 'P1.2 SIM+', unit: 'µA', scale: 1000, ok: 40, warn: 80, match: (o) => !!o.sink },
});
