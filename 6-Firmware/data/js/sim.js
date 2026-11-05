/*
  IO Tester — pagina "Simula trasmettitore" / "Simulate transmitter" page
  IT: Configurazione del sink a 2 fili (P1.2 SIM+ / P1.1 COM), loop alimentato dal PLC; la logica è in output-page.js.
  EN: Configuration of the 2-wire sink (P1.2 SIM+ / P1.1 COM), loop powered by the PLC; the logic is in output-page.js.
*/
'use strict';

initOutputPage({
  sink: true,                      // IT: stato = out.sink / EN: state = out.sink
  enableKey: 'btn_enable_s',       // IT: ATTIVA SIMULAZIONE / EN: ENABLE SIMULATION
  api: API.outSink,
  min: 0,
  max: 22,
  unit: 'mA',
  def: 12,
  spKey: 'iotester.sim.sp',
  calKey: 'sink',
  faultKey: 'fault_s',
  // IT: loopback P2.5 L+ → P1.2, P1.1 → P2.4: scarto in µA, verde ≤ 40 µA (±0,21% di 16 mA, collaudo fase 7), arancio ≤ 80 µA
  // EN: loopback P2.5 L+ → P1.2, P1.1 → P2.4: deviation in µA, green ≤ 40 µA (±0.21% of 16 mA, test phase 7), amber ≤ 80 µA
  // IT: 2 fili: solo 4–20 mA (sotto 4 mA il trasmettitore non si alimenta) / EN: 2-wire: 4–20 mA only (below 4 mA the transmitter is not powered)
  ranges: [{ id: '4-20', label: '4–20 mA', lo: 4, hi: 20 }],
  scaleKey: 'iotester.scale.sim',
  loop: { field: 'i', port: 'P2.4', scale: 1000, unit: 'µA', ok: 40, warn: 80 },
});
