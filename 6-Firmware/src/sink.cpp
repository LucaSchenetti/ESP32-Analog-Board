/*
  IT: Sink a 2 fili: setpoint tramite AD5412, abilitazione GPIO38.
  EN: 2-wire sink: setpoint via AD5412, GPIO38 enable.
*/
#include "sink.h"

#include <Arduino.h>
#include "calib.h"
#include "pins.h"

static const float R16 = 25.5f;      // shunt
static const float R19 = 15400.0f;   // partitore del setpoint
static const float R20 = 1000.0f;
static const float MA_PER_V = R20 / (R19 + R20) / R16 * 1000.0f;   // 2,391 mA/V
static const float MA_MAX = 23.0f;   // 10 V → 23,9 mA teorici

static bool enabled = false;
static float setpoint_ma = 0.0f;
static float nominal_ma = 0.0f;

// IT: GPIO38 alto prima di abilitarlo come uscita (nessun glitch).
// EN: GPIO38 high before enabling it as output (no glitch).
void sink_init() {
    digitalWrite(PIN_SINK_EN, HIGH);
    pinMode(PIN_SINK_EN, OUTPUT);
    enabled = false;
}

// IT: Setpoint nominale, poi abilitazione.
// EN: Nominal setpoint, then enable.
DacOutStatus sink_set_ma_raw(float ma) {
    ma = constrain(ma, 0.0f, MA_MAX);
    float v = ma / MA_PER_V;
    uint16_t code = (uint16_t)lroundf(v / 10.0f * 4096.0f);
    // Prima il setpoint (AD5412 in 0–10 V), poi l'abilitazione: Q2 parte già al valore giusto.
    DacOutStatus st = dac_out_set_code(DAC_OUT_V_0_10, code);
    setpoint_ma = st.theory * MA_PER_V;
    nominal_ma = setpoint_ma;
    digitalWrite(PIN_SINK_EN, LOW);
    enabled = true;
    return st;
}

// IT: Setpoint calibrato, poi abilitazione.
// EN: Calibrated setpoint, then enable.
// Calibrazione: reale = gain × teorico + offset → teorico da impostare = (voluta − offset) / gain.
DacOutStatus sink_set_ma(float ma) {
    DacOutStatus st = sink_set_ma_raw(calib_inverse(CAL_SINK, ma));
    setpoint_ma = calib_apply(CAL_SINK, setpoint_ma);
    return st;
}

// IT: Blocco hardware (GPIO38) e uscita AD5412 disabilitata.
// EN: Hardware interlock (GPIO38) and AD5412 output disabled.
void sink_disable() {
    digitalWrite(PIN_SINK_EN, HIGH);   // prima il blocco hardware (Q1 spegne Q2)
    enabled = false;
    setpoint_ma = 0.0f;
    nominal_ma = 0.0f;
    dac_output_disable();
}

// IT: true se il sink è abilitato.
// EN: true if the sink is enabled.
bool sink_enabled() {
    return enabled;
}

// IT: Corrente nominale del codice scritto (0 se spento).
// EN: Nominal current of the written code (0 when off).
float sink_nominal_ma() {
    return enabled ? nominal_ma : 0.0f;
}

// IT: Corrente attesa (0 se spento).
// EN: Expected current (0 when off).
float sink_setpoint_ma() {
    return enabled ? setpoint_ma : 0.0f;
}
