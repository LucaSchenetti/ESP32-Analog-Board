/*
  IT: Misura VUSB e presenza delle alimentazioni esterne.
  EN: VUSB measurement and external supply presence.
*/
#include "power.h"

#include <Arduino.h>
#include "pins.h"

// Partitore VUSB: R1 150 kΩ (alto) / R2 68 kΩ (basso) → 5,00 V = 1,560 V sul pin.
static const float R1 = 150000.0f;
static const float R2 = 68000.0f;
// Correzione da taratura con multimetro (VUSB_multimetro / VUSB_letto).
// 2026-09-29: multimetro 5,000 V, letto 4,902 V (ATTEN2) → 5,000 / 4,902 = 1,0200.
// Valida in ATTEN2; in ATTEN3 (VUSB > ~5,05 V) l'errore dell'ADC è diverso.
static const float VUSB_CAL = 1.0200f;

// ESP32-S3 datasheet v2.2, Tabella 5-6 (errore totale dopo calibrazione):
//   ATTEN2 (ADC_6db):  0…1600 mV, ±10 mV   → VUSB max 5,13 V
//   ATTEN3 (ADC_11db): 0…2900 mV, ±50 mV
// Si legge in ATTEN2 e si passa ad ATTEN3 solo vicino al fondo scala.
static const uint32_t ATTEN2_LIMIT_MV = 1550;
static const int N_SAMPLES = 32;

// IT: Media di 32 letture ADC calibrate con l'attenuazione data.
// EN: Average of 32 calibrated ADC readings at the given attenuation.
static uint32_t read_mv(adc_attenuation_t att) {
    analogSetPinAttenuation(PIN_VUSB_SENSE, att);
    uint32_t sum = 0;
    for (int i = 0; i < N_SAMPLES; i++) sum += analogReadMilliVolts(PIN_VUSB_SENSE);
    return sum / N_SAMPLES;
}

// IT: Configura gli ingressi di presenza 24 V / 5 V.
// EN: Configures the 24 V / 5 V presence inputs.
void power_init() {
    pinMode(PIN_EXT24V_PRESENT, INPUT);
    pinMode(PIN_EXT5V_PRESENT, INPUT);
}

// IT: Legge VUSB (portata automatica) e presenze.
// EN: Reads VUSB (automatic range) and presence inputs.
PowerStatus power_read() {
    PowerStatus s;
    s.atten = 2;
    s.pin_mv = read_mv(ADC_6db);
    if (s.pin_mv > ATTEN2_LIMIT_MV) {
        s.atten = 3;
        s.pin_mv = read_mv(ADC_11db);
    }
    s.vusb_mv = (uint32_t)(s.pin_mv * (R1 + R2) / R2 * VUSB_CAL + 0.5f);
    s.ext24 = digitalRead(PIN_EXT24V_PRESENT);
    s.ext5 = digitalRead(PIN_EXT5V_PRESENT);
    return s;
}
