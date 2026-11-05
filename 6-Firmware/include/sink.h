#pragma once
/*
  Sink a 2 fili / 2-wire current sink
  IT: Simula un trasmettitore passivo 4–20 mA: OP184 + Q2 + shunt R16 25,5 Ω. Il valore di
      corrente è la tensione V_SENSE dell'AD5412 (modo 0–10 V) × 1 kΩ / 16,4 kΩ / 25,5 Ω = 2,391 mA/V.
      Abilitazione con GPIO38 BASSO; ALTO = disabilitato (stato sicuro, interlock Q1).
  EN: Simulates a passive 4–20 mA transmitter: OP184 + Q2 + 25.5 Ω shunt R16. The current
      setpoint is the AD5412 V_SENSE voltage (0–10 V mode) × 1 kΩ / 16.4 kΩ / 25.5 Ω = 2.391 mA/V.
      Enabled with GPIO38 LOW; HIGH = disabled (safe state, Q1 interlock).
*/

#include "dac.h"

// IT: Porta GPIO38 ALTO (sink disabilitato): va chiamata per prima all'avvio.
// EN: Drives GPIO38 HIGH (sink disabled): must be the first call at boot.
void sink_init();

// IT: Imposta la corrente voluta con la calibrazione CAL_SINK, poi abilita il sink.
// EN: Sets the wanted current with CAL_SINK calibration, then enables the sink.
DacOutStatus sink_set_ma(float ma);

// IT: Imposta la corrente nominale (resistenze nominali, senza calibrazione) e abilita il sink.
// EN: Sets the nominal current (nominal resistors, no calibration) and enables the sink.
DacOutStatus sink_set_ma_raw(float ma);

// IT: Disabilita il sink (GPIO38 ALTO) e poi l'uscita AD5412. EN: Disables the sink (GPIO38 HIGH), then the AD5412 output.
void sink_disable();

// IT: true se il sink è abilitato. EN: true if the sink is enabled.
bool sink_enabled();

// IT: Corrente nominale (resistenze nominali, senza calibrazione) del codice scritto; 0 se spento.
// EN: Nominal current (nominal resistors, no calibration) of the written code; 0 when off.
float sink_nominal_ma();

// IT: Corrente attesa: nominale, o corretta se calibrato; 0 se spento.
// EN: Expected current: nominal, or corrected if calibrated; 0 when off.
float sink_setpoint_ma();
