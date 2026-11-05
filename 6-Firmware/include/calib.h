#pragma once
/*
  Calibrazione / Calibration
  IT: Coefficienti di calibrazione per 5 canali, salvati in NVS con data e temperatura.
      Convenzione: valore_reale = gain × valore_nominale + offset (unità del canale, V o mA).
  EN: Calibration coefficients for 5 channels, stored in NVS with date and temperature.
      Convention: real_value = gain × nominal_value + offset (channel unit, V or mA).
*/

#include <Arduino.h>

// IT: Canali calibrabili e metodo di calibrazione. EN: Calibratable channels and method.
enum CalChannel : uint8_t {
    CAL_SINK = 0,   // IT: sink 2 fili [mA], loopback / EN: 2-wire sink, loopback
    CAL_VOUT,       // IT: uscita tensione [V], loopback / EN: voltage output, loopback
    CAL_IOUT,       // IT: uscita corrente [mA], loopback / EN: current output, loopback
    CAL_VIN,        // IT: ingresso tensione [V], 2 punti esterni / EN: voltage input, 2 external points
    CAL_IIN,        // IT: ingresso corrente [mA], 2 punti esterni / EN: current input, 2 external points
    CAL_N
};

// IT: Coefficienti di un canale; temp_c = temperatura ADS1220 alla calibrazione (base per la deriva).
// EN: Coefficients of one channel; temp_c = ADS1220 temperature at calibration (basis for drift).
struct CalCoeff {
    float gain = 1.0f;
    float offset = 0.0f;
    uint32_t date = 0;         // IT: epoch UNIX dal browser / EN: UNIX epoch from the browser
    float temp_c = NAN;
    bool valid = false;
};

// IT: Carica tutti i coefficienti dalla NVS (all'avvio). EN: Loads all coefficients from NVS (at boot).
void calib_load();

// IT: Coefficienti attuali di un canale. EN: Current coefficients of a channel.
CalCoeff calib_get(CalChannel ch);

// IT: Cancella la calibrazione di un canale (torna ai valori nominali). EN: Clears a channel's calibration.
void calib_clear(CalChannel ch);

// IT: Unità del canale ("V" o "mA"). EN: Channel unit ("V" or "mA").
const char *calib_unit(CalChannel ch);

// IT: Ingressi: valore corretto da quello nominale. Senza calibrazione restituisce il nominale.
// EN: Inputs: corrected value from the nominal one. Without calibration returns the nominal value.
float calib_apply(CalChannel ch, float nominal);

// IT: Uscite: valore nominale da impostare per ottenere quello voluto. Senza calibrazione: identità.
// EN: Outputs: nominal value to set in order to obtain the wanted one. Without calibration: identity.
float calib_inverse(CalChannel ch, float target);

// IT: Calibrazione a due punti di VIN / IIN: meas* = letture nominali ADS1220 (v_nom / i_nom),
//     ref* = valori dello strumento di riferimento. Salva se plausibile, altrimenti spiega in err.
// EN: Two-point calibration of VIN / IIN: meas* = nominal ADS1220 readings (v_nom / i_nom),
//     ref* = reference instrument values. Saves if plausible, otherwise explains in err.
bool calib_input_two_point(CalChannel ch, float meas1, float ref1, float meas2, float ref2,
                           uint32_t epoch, String &err);

// IT: Avvia la calibrazione automatica in loopback di SINK / VOUT / IOUT (task separato, ~20 s).
//     Collegamenti: SINK P2.5 L+ → P1.2 SIM+, P1.1 COM → P2.4 mA+ · VOUT P1.4 V+ → P2.2 V+, P1.1 COM → P2.1 V− ·
//     IOUT P1.3 mA+ → P2.4 mA+, P1.1 COM → P2.3 mA−. Restituisce false se una calibrazione è già in corso.
// EN: Starts the automatic loopback calibration of SINK / VOUT / IOUT (separate task, ~20 s).
//     Wiring as above. Returns false if a calibration is already running.
bool calib_output_start(CalChannel ch, uint32_t epoch);

// IT: Esito dell'ultima procedura automatica (true = coefficienti salvati e verificati).
// EN: Result of the last automatic procedure (true = coefficients saved and verified).
bool calib_last_ok();

// IT: true mentre una calibrazione automatica è in corso. EN: true while an automatic calibration runs.
bool calib_running();

// IT: Stato della procedura (punti misurati, verifica, coefficienti) in JSON.
// EN: Procedure state (measured points, verification, coefficients) as JSON.
String calib_status_json();

// IT: Compatibilità con la pagina di collaudo (sink). EN: Compatibility with the test page (sink).
inline CalCoeff calib_get_sink() { return calib_get(CAL_SINK); }
inline void calib_clear_sink() { calib_clear(CAL_SINK); }
inline bool calib_sink_start(uint32_t epoch) { return calib_output_start(CAL_SINK, epoch); }
