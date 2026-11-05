#pragma once
/*
  AD5412 — uscita isolata (COM_OUT) / isolated output (COM_OUT)
  IT: DAC 12 bit su SPI (FSPI, mode 0) attraverso l'isolatore NSI8262. Uscita tensione 0–10 V
      (P1.4 V+) o corrente 4–20 mA (P1.3 mA+), riferite a P1.1 COM, lettura del pin FAULT e dei registri.
  EN: 12-bit DAC on SPI (FSPI, mode 0) through the NSI8262 isolator. 0–10 V voltage output (P1.4 V+)
      or 4–20 mA current output (P1.3 mA+), referred to P1.1 COM, FAULT pin and register readback.
  Datasheet: AD5412 Rev. P.
*/

#include <Arduino.h>

// IT: Indirizzi dei registri (Tabella 9). EN: Register addresses (Table 9).
enum : uint8_t {
    DAC_ADDR_NOP      = 0x00,
    DAC_ADDR_DATA     = 0x01,
    DAC_ADDR_READBACK = 0x02,
    DAC_ADDR_CONTROL  = 0x55,
    DAC_ADDR_RESET    = 0x56,
};

// IT: Registro da rileggere (Tabella 10). EN: Register to read back (Table 10).
enum : uint8_t {
    DAC_READ_STATUS  = 0x00,
    DAC_READ_DATA    = 0x01,
    DAC_READ_CONTROL = 0x02,
};

// IT: Configura LATCH, FAULT e il bus SPI; crea il mutex di accesso.
// EN: Configures LATCH, FAULT and the SPI bus; creates the access mutex.
void dac_init();

// IT: Scrive una parola da 24 bit (indirizzo + dato) e la carica con LATCH.
// EN: Writes a 24-bit word (address + data) and loads it with LATCH.
void dac_write(uint8_t addr, uint16_t data);

// IT: Rilegge un registro (status, data o control). EN: Reads back a register (status, data or control).
uint16_t dac_read(uint8_t read_addr);

// IT: Reset software: stato di power-on, uscite disabilitate. EN: Software reset: power-on state, outputs off.
void dac_reset();

// IT: true se il pin FAULT è attivo (basso). EN: true if the FAULT pin is active (low).
bool dac_fault();

// IT: Modo dell'uscita. EN: Output mode.
enum DacOutMode : uint8_t { DAC_OUT_OFF = 0, DAC_OUT_V_0_10 = 1, DAC_OUT_I_4_20 = 2, DAC_OUT_I_0_20 = 3, DAC_OUT_I_0_24 = 4 };

// IT: Stato dell'uscita con i registri riletti dal chip. EN: Output state with registers read back from the chip.
struct DacOutStatus {
    DacOutMode mode;
    uint16_t code;        // IT: codice scritto (12 bit) / EN: written code
    uint16_t code_rb;     // IT: codice riletto / EN: read-back code
    uint16_t ctrl_rb;     // IT: registro di controllo / EN: control register
    uint16_t status_rb;   // IT: registro di stato (D2 IOUT fault, D0 sovratemperatura) / EN: status register
    float theory;         // IT: valore nominale V o mA / EN: nominal value V or mA
    float expected;       // IT: valore atteso con la calibrazione (= theory se non calibrato) / EN: expected value with calibration
    bool fault;           // IT: pin FAULT / EN: FAULT pin
};

// IT: Abilita il modo richiesto (passando dal reset, Fig. 69) e scrive il codice; restituisce lo stato.
// EN: Enables the requested mode (through reset, Fig. 69) and writes the code; returns the state.
DacOutStatus dac_out_set_code(DacOutMode mode, uint16_t code);

// IT: Uscita tensione con la formula nominale (eq. 2). EN: Voltage output with the nominal formula (eq. 2).
DacOutStatus dac_set_voltage_raw(float v);

// IT: Uscita corrente con la formula nominale: 4–20 mA (eq. 6) oppure, con zero20, 0–20 mA (eq. 4).
// EN: Current output with the nominal formula: 4–20 mA (eq. 6) or, with zero20, 0–20 mA (eq. 4).
DacOutStatus dac_set_current_raw(float ma, bool zero20 = false);

// IT: Uscita tensione con la calibrazione CAL_VOUT. EN: Voltage output with CAL_VOUT calibration.
DacOutStatus dac_set_voltage(float v);

// IT: Uscita corrente con la calibrazione CAL_IOUT (stessa RSET in entrambi i campi). EN: Current output with CAL_IOUT calibration (same RSET in both ranges).
DacOutStatus dac_set_current(float ma, bool zero20 = false);

// IT: true se il modo è un'uscita in corrente (4–20 o 0–20 mA). EN: true if the mode is a current output (4–20 or 0–20 mA).
inline bool dac_mode_is_current(DacOutMode m) { return m == DAC_OUT_I_4_20 || m == DAC_OUT_I_0_20 || m == DAC_OUT_I_0_24; }

// IT: Corrente nel campo 0–24 mA (eq. 5) con la calibrazione CAL_IOUT: usata dal simulatore per i valori
//     fuori campo e di guasto (3,6 mA, 21 mA). EN: Current in the 0–24 mA range (eq. 5) with CAL_IOUT calibration:
//     used by the simulator for out-of-range and failure values (3.6 mA, 21 mA).
DacOutStatus dac_set_current_024(float ma);

// IT: Porta il dato a 0 e disabilita l'uscita (alta impedenza). EN: Sets data to 0 and disables the output (high-Z).
void dac_output_disable();

// IT: true se un'uscita è abilitata. EN: true if an output is enabled.
bool dac_output_enabled();

// IT: Stato attuale con i registri riletti. EN: Current state with read-back registers.
DacOutStatus dac_out_status();

// IT: Test SPI con rilettura; non abilita mai le uscite; risultato JSON in report.
// EN: SPI test with readback; never enables the outputs; JSON result in report.
bool dac_selftest(String &report);
