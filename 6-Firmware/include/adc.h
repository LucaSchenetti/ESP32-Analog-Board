#pragma once
/*
  ADS1220 — ingresso isolato (COM_IN) / isolated input (COM_IN)
  IT: Convertitore 24 bit su SPI (HSPI, mode 1) attraverso l'isolatore NSI8262. Misura la tensione
      V+ (partitore 90,9 k / 10 k) e la corrente mA+ (shunt R34 25,5 Ω), più la temperatura interna.
  EN: 24-bit converter on SPI (HSPI, mode 1) through the NSI8262 isolator. Measures voltage V+
      (90.9 k / 10 k divider) and current mA+ (25.5 Ω shunt R34), plus the internal temperature.
  Datasheet: ADS1220 SBAS501D.
*/

#include <Arduino.h>

// IT: Comandi SPI (Tabella 8-7). EN: SPI commands (Table 8-7).
enum : uint8_t {
    ADC_CMD_RESET = 0x06,
    ADC_CMD_START = 0x08,
    ADC_CMD_POWERDOWN = 0x02,
    ADC_CMD_RDATA = 0x10,
    ADC_CMD_RREG = 0x20,
    ADC_CMD_WREG = 0x40,
};

// IT: Configura i pin (CS, DRDY) e il bus SPI; crea il mutex di accesso.
// EN: Configures the pins (CS, DRDY) and the SPI bus; creates the access mutex.
void adc_init();

// IT: Reset software: tutti i registri a 00h, attesa ≥ 50 µs + 32 tCLK (§8.5.3.1).
// EN: Software reset: all registers to 00h, waits ≥ 50 µs + 32 tCLK (§8.5.3.1).
void adc_reset();

// IT: Legge i 4 registri di configurazione. EN: Reads the 4 configuration registers.
void adc_read_regs(uint8_t regs[4]);

// IT: Scrive i 4 registri di configurazione. EN: Writes the 4 configuration registers.
void adc_write_regs(const uint8_t regs[4]);

// IT: Misura il sensore di temperatura interno (single-shot, 20 SPS); false se DRDY non scende.
// EN: Reads the internal temperature sensor (single-shot, 20 SPS); false if DRDY never goes low.
bool adc_read_temperature(float &temp_c, uint32_t &conv_ms);

// IT: Risultato della misura continua (medie mobili su 10 letture per canale).
// EN: Continuous measurement result (moving average over 10 readings per channel).
struct AdcReadings {
    float v, v_min, v_max;          // IT: tensione [V], calibrata se CAL_VIN valido / EN: voltage, calibrated if CAL_VIN valid
    float i_ma, i_min, i_max;       // IT: corrente [mA], calibrata se CAL_IIN valido / EN: current, calibrated if CAL_IIN valid
    float v_nom, i_nom;             // IT: medie con componenti nominali / EN: averages with nominal components
    float v_last, i_last;           // IT: ultima conversione singola, calibrata (senza media) / EN: last single conversion, calibrated (no averaging)
    int32_t code_v, code_i;         // IT: ultimi codici grezzi / EN: last raw codes
    bool sat_v, sat_i;              // IT: fuori scala (7FFFFFh / 800000h) / EN: over-range
    float temp_c;                   // IT: temperatura interna / EN: internal temperature
    uint32_t n, errors;             // IT: conversioni riuscite / timeout DRDY — EN: good conversions / DRDY timeouts
};

// IT: Avvia il task di misura continua (core 1): V e I alternate, temperatura ogni ~2 s.
// EN: Starts the continuous measurement task (core 1): V and I alternated, temperature every ~2 s.
void adc_measure_start();

// IT: Restituisce una copia coerente delle ultime misure. EN: Returns a consistent copy of the latest readings.
AdcReadings adc_get();

// IT: Canale prioritario: 0 = alterna V e I (normale), 1 = solo tensione, 2 = solo corrente (≈ 20 letture/s,
//     usato dal simulatore di processo per leggere l'uscita del PLC senza ritardo).
// EN: Focus channel: 0 = alternate V and I (normal), 1 = voltage only, 2 = current only (≈ 20 readings/s,
//     used by the process simulator to read the PLC output without delay).
void adc_set_focus(uint8_t ch);

// IT: Test SPI con rilettura dei registri e conversione di temperatura; risultato JSON in report.
//     Non accende IDAC, burn-out (BCS) né lo switch low-side (PSW).
// EN: SPI test with register readback and a temperature conversion; JSON result in report.
//     Never enables IDACs, burn-out sources (BCS) or the low-side switch (PSW).
bool adc_selftest(String &report);
