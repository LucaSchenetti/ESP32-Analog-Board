/*
  IO Tester — pagina "Genera corrente" / "Generate current" page
  IT: Configurazione dell'uscita 4–20 mA attiva (P1.3 mA+ / P1.1 COM); la logica è in output-page.js.
  EN: Configuration of the active 4–20 mA output (P1.3 mA+ / P1.1 COM); the logic is in output-page.js.
*/
'use strict';

initOutputPage({
  mode: 2,                         // IT: out.mode corrente / EN: current out.mode
  api: API.outI,
  min: 4,
  max: 20,
  unit: 'mA',
  def: 12,
  spKey: 'iotester.geni.sp',
  calKey: 'iout',
  faultKey: 'fault_i',
  // IT: loopback P1.3 → P2.4: scarto in µA, verde ≤ 20 µA, arancio ≤ 50 µA
  // EN: loopback P1.3 → P2.4: deviation in µA, green ≤ 20 µA, amber ≤ 50 µA
  modes: [2, 3],                   // IT: 4–20 mA (2) e 0–20 mA (3) / EN: 4–20 mA (2) and 0–20 mA (3)
  ranges: [
    { id: '4-20', label: '4–20 mA', lo: 4, hi: 20, min: 4, q: '' },
    { id: '0-20', label: '0–20 mA', lo: 0, hi: 20, min: 0, q: '&range=0' },   // IT: AD5412 Tab. 17, R = 110 / EN: AD5412 Table 17, R = 110
  ],
  scaleKey: 'iotester.scale.gen-i',
  loop: { field: 'i', port: 'P2.4', scale: 1000, unit: 'µA', ok: 20, warn: 50 },
});
