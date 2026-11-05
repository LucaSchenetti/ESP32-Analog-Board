/*
  IO Tester — pagina "Genera tensione" / "Generate voltage" page
  IT: Configurazione dell'uscita 0–10 V (P1.4 V+ / P1.1 COM); la logica è in output-page.js.
  EN: Configuration of the 0–10 V output (P1.4 V+ / P1.1 COM); the logic is in output-page.js.
*/
'use strict';

initOutputPage({
  mode: 1,                         // IT: out.mode tensione / EN: voltage out.mode
  api: API.outV,
  min: 0,
  max: 10,
  unit: 'V',
  def: 5,
  spKey: 'iotester.genv.sp',
  calKey: 'vout',
  faultKey: 'fault_v',
  // IT: loopback P1.4 → P2.2: scarto in mV, verde ≤ 10 mV, arancio ≤ 30 mV
  // EN: loopback P1.4 → P2.2: deviation in mV, green ≤ 10 mV, amber ≤ 30 mV
  ranges: [{ id: '0-10', label: '0–10 V', lo: 0, hi: 10 }],
  scaleKey: 'iotester.scale.gen-v',
  loop: { field: 'v', port: 'P2.2', scale: 1000, unit: 'mV', ok: 10, warn: 30 },
});
