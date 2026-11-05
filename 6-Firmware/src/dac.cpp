/*
  IT: AD5412: driver SPI, uscite tensione/corrente e test.
  EN: AD5412: SPI driver, voltage/current outputs and self-test.
*/
#include "dac.h"

#include <SPI.h>
#include "calib.h"
#include "pins.h"

// Interfaccia (AD5412 datasheet Rev. P):
// - parola da 24 bit, MSB first: 8 bit indirizzo + 16 bit dati (Tabella 8)
// - SDIN campionato sul fronte di salita di SCLK, SCLK a riposo basso → SPI mode 0 (Figura 2)
// - fronte di salita di LATCH carica la parola; LATCH alto ≥ 5 µs (t5, Tabella 5)
// - readback: scrittura 0x02 + indirizzo, poi NOP; gli ultimi 16 bit su SDO sono il registro
//   (Tabella 12, Figura 3)
// Clock a 1 MHz per il bring-up: ampio margine sui ritardi dell'isolatore NSI8262.

static SPIClass dac_spi(FSPI);
// Il DAC è usato dal task AsyncTCP (pagina web) e dal task "web" (spegnimento automatico):
// ogni funzione pubblica prende il mutex (ricorsivo: il self-test richiama le altre).
static SemaphoreHandle_t dac_mutex;
static DacOutMode out_mode = DAC_OUT_OFF;
static uint16_t out_code = 0;

struct DacLock {
    DacLock() { xSemaphoreTakeRecursive(dac_mutex, portMAX_DELAY); }
    ~DacLock() { xSemaphoreGiveRecursive(dac_mutex); }
};
static const SPISettings DAC_SPI(1000000, MSBFIRST, SPI_MODE0);

// IT: Trasferisce 24 bit e genera l'impulso di LATCH; restituisce i 24 bit letti da SDO.
// EN: Transfers 24 bits and pulses LATCH; returns the 24 bits read from SDO.
static uint32_t xfer24(uint32_t word) {
    dac_spi.beginTransaction(DAC_SPI);
    uint32_t rx = 0;
    for (int shift = 16; shift >= 0; shift -= 8) {
        rx = (rx << 8) | dac_spi.transfer((word >> shift) & 0xFF);
    }
    dac_spi.endTransaction();

    digitalWrite(PIN_DAC_LATCH, LOW);    // t8 ≥ 40 ns
    delayMicroseconds(1);
    digitalWrite(PIN_DAC_LATCH, HIGH);   // fronte di salita: carica la parola
    delayMicroseconds(10);               // t5 ≥ 5 µs
    return rx;
}

// IT: Configura LATCH, FAULT e bus SPI.
// EN: Configures LATCH, FAULT and the SPI bus.
void dac_init() {
    dac_mutex = xSemaphoreCreateRecursiveMutex();
    pinMode(PIN_DAC_LATCH, OUTPUT);
    digitalWrite(PIN_DAC_LATCH, HIGH);   // a riposo alto (Figura 2)
    pinMode(PIN_DAC_FAULT, INPUT_PULLUP);
    dac_spi.begin(PIN_DAC_SCLK, PIN_DAC_SDO, PIN_DAC_SDIN, -1);
}

// IT: Scrive un registro.
// EN: Writes a register.
void dac_write(uint8_t addr, uint16_t data) {
    DacLock lock;
    xfer24(((uint32_t)addr << 16) | data);
}

// IT: Rilegge un registro (comando 0x02 + NOP).
// EN: Reads back a register (0x02 command + NOP).
uint16_t dac_read(uint8_t read_addr) {
    DacLock lock;
    xfer24(((uint32_t)DAC_ADDR_READBACK << 16) | (read_addr & 0x03));
    return xfer24(0x000000) & 0xFFFF;
}

// IT: Reset software e attesa ≥ 40 µs.
// EN: Software reset and ≥ 40 µs wait.
void dac_reset() {
    DacLock lock;
    out_mode = DAC_OUT_OFF;
    // Reset software: stato di power-on, uscite in tristate. Serve anche perché con
    // DVCC interno la rampa di alimentazione deve essere > 2000 V/s, altrimenti il
    // datasheet raccomanda un reset dopo l'accensione (pag. 29). Attesa ≥ 40 µs.
    dac_write(DAC_ADDR_RESET, 0x0001);
    delay(1);
}

// IT: Legge il pin FAULT (attivo basso).
// EN: Reads the FAULT pin (active low).
bool dac_fault() {
    return digitalRead(PIN_DAC_FAULT) == LOW;
}

// ── Uscite ──────────────────────────────────────────────────────────────────
// Sequenza della Figura 69: reset software, poi una sola scrittura del controllo con
// REXT + range + OUTEN; poi il dato. All'abilitazione l'uscita va al fondo del range
// (0 V / 4 mA, CLRSEL = 0, Tabella 22).
//
// Tensione 0–10 V: R = 001 (Tabella 17), guadagno 2 (Tabella 11) → VOUT = 10 V × D / 4096 (eq. 2)
// Corrente 4–20 mA: R = 101 (Tabella 17), REXT = 1 (RSET esterno 15 kΩ 0,1%)
//                   → IOUT = 16 mA × D / 4096 + 4 mA (eq. 6)
// Corrente 0–20 mA: R = 110 (Tabella 17), REXT = 1 → IOUT = 20 mA × D / 4096 (eq. 4);
//                   INL specificata da codice 16 (≈ 78 µA, Tab. 2 nota 4)
// Corrente 0–24 mA: R = 111 (Tabella 17), REXT = 1 → IOUT = 24 mA × D / 4096 (eq. 5); usata dal simulatore
// Slew rate e DCEN sempre a 0.
static const uint16_t CTRL_OUTEN = 1u << 12;
static const uint16_t CTRL_REXT = 1u << 13;
static const uint16_t CTRL_V_0_10 = CTRL_OUTEN | 0x0001;              // 0x1001
static const uint16_t CTRL_I_4_20 = CTRL_REXT | CTRL_OUTEN | 0x0005;  // 0x3005
static const uint16_t CTRL_I_0_20 = CTRL_REXT | CTRL_OUTEN | 0x0006;  // 0x3006
static const uint16_t CTRL_I_0_24 = CTRL_REXT | CTRL_OUTEN | 0x0007;  // 0x3007 (R = 111, Tabella 17)

// IT: Valore nominale (V o mA) di un codice nel modo dato.
// EN: Nominal value (V or mA) of a code in the given mode.
static float theory(DacOutMode mode, uint16_t code) {
    switch (mode) {
        case DAC_OUT_V_0_10: return 10.0f * code / 4096.0f;
        case DAC_OUT_I_4_20: return 16.0f * code / 4096.0f + 4.0f;
        case DAC_OUT_I_0_20: return 20.0f * code / 4096.0f;
        case DAC_OUT_I_0_24: return 24.0f * code / 4096.0f;
        default:             return 0.0f;
    }
}

// IT: Stato dell'uscita con registri riletti.
// EN: Output state with read-back registers.
DacOutStatus dac_out_status() {
    DacLock lock;
    DacOutStatus st;
    st.mode = out_mode;
    st.code = out_code;
    st.ctrl_rb = dac_read(DAC_READ_CONTROL);
    st.code_rb = dac_read(DAC_READ_DATA) >> 4;
    st.status_rb = dac_read(DAC_READ_STATUS);
    st.theory = theory(out_mode, out_code);
    // IT: uscita reale stimata = gain × nominale + offset (calibrazione del modo attivo)
    // EN: estimated real output = gain × nominal + offset (calibration of the active mode)
    st.expected = out_mode == DAC_OUT_OFF ? 0.0f
                : calib_apply(out_mode == DAC_OUT_V_0_10 ? CAL_VOUT : CAL_IOUT, st.theory);   // 4–20 e 0–20 mA: CAL_IOUT
    st.fault = dac_fault();
    return st;
}

// IT: Abilita il modo (con reset) e scrive il codice.
// EN: Enables the mode (with reset) and writes the code.
DacOutStatus dac_out_set_code(DacOutMode mode, uint16_t code) {
    DacLock lock;
    if (mode == DAC_OUT_OFF) {
        dac_output_disable();
        return dac_out_status();
    }
    if (code > 4095) code = 4095;
    if (out_mode != mode) {
        dac_reset();   // uscite disabilitate prima di cambiare range
        dac_write(DAC_ADDR_CONTROL, mode == DAC_OUT_V_0_10 ? CTRL_V_0_10 : mode == DAC_OUT_I_0_20 ? CTRL_I_0_20
                                    : mode == DAC_OUT_I_0_24 ? CTRL_I_0_24 : CTRL_I_4_20);
        out_mode = mode;
    }
    dac_write(DAC_ADDR_DATA, code << 4);   // AD5412: dato in D15..D4 (Tabella 13)
    out_code = code;
    return dac_out_status();
}

// IT: Tensione con formula nominale.
// EN: Voltage with the nominal formula.
DacOutStatus dac_set_voltage_raw(float v) {
    float frac = constrain(v, 0.0f, 10.0f) / 10.0f;                 // VOUT = 10 V × D / 4096
    return dac_out_set_code(DAC_OUT_V_0_10, (uint16_t)lroundf(frac * 4096.0f));
}

// IT: Corrente con formula nominale.
// EN: Current with the nominal formula.
DacOutStatus dac_set_current_raw(float ma, bool zero20) {
    if (zero20) {
        float frac = constrain(ma, 0.0f, 20.0f) / 20.0f;           // IOUT = 20 mA × D / 4096
        return dac_out_set_code(DAC_OUT_I_0_20, (uint16_t)lroundf(frac * 4096.0f));
    }
    float frac = (constrain(ma, 4.0f, 20.0f) - 4.0f) / 16.0f;      // IOUT = 16 mA × D / 4096 + 4 mA
    return dac_out_set_code(DAC_OUT_I_4_20, (uint16_t)lroundf(frac * 4096.0f));
}

// IT: Corrente 0–24 mA con calibrazione CAL_IOUT (IOUT = 24 mA × D / 4096, eq. 5).
// EN: 0–24 mA current with CAL_IOUT calibration (IOUT = 24 mA × D / 4096, eq. 5).
DacOutStatus dac_set_current_024(float ma) {
    float frac = constrain(calib_inverse(CAL_IOUT, ma), 0.0f, 24.0f) / 24.0f;
    long code = lroundf(frac * 4096.0f);
    return dac_out_set_code(DAC_OUT_I_0_24, (uint16_t)min(code, 4095L));
}

// IT: Tensione con calibrazione CAL_VOUT.
// EN: Voltage with CAL_VOUT calibration.
DacOutStatus dac_set_voltage(float v) {
    return dac_set_voltage_raw(calib_inverse(CAL_VOUT, v));
}

// IT: Corrente con calibrazione CAL_IOUT.
// EN: Current with CAL_IOUT calibration.
DacOutStatus dac_set_current(float ma, bool zero20) {
    return dac_set_current_raw(calib_inverse(CAL_IOUT, ma), zero20);
}

// IT: Dato a 0 e uscita disabilitata.
// EN: Data to 0 and output disabled.
void dac_output_disable() {
    DacLock lock;
    dac_write(DAC_ADDR_DATA, 0x0000);
    dac_write(DAC_ADDR_CONTROL, 0x0000);   // OUTEN = 0: uscite in alta impedenza
    out_mode = DAC_OUT_OFF;
    out_code = 0;
}

// IT: true se un'uscita è attiva.
// EN: true if an output is active.
bool dac_output_enabled() {
    return out_mode != DAC_OUT_OFF;
}

// ── Test ────────────────────────────────────────────────────────────────────

struct Step {
    const char *name;
    uint8_t write_addr;    // 0 = nessuna scrittura
    uint16_t write_val;
    uint8_t read_addr;
    uint16_t expect;
    uint16_t mask;
};

// Valori di prova del registro di controllo: OUTEN (D12) = 0, DCEN (D3) = 0, REXT (D13) = 0.
// Cambiano solo slew rate e range: le uscite restano in tristate.
static const Step STEPS[] = {
    {"Status dopo reset",         0,                0,      DAC_READ_STATUS,  0x0000, 0xFFFF},
    {"Control dopo reset",        0,                0,      DAC_READ_CONTROL, 0x0000, 0xFFFF},
    {"Control = 0x0AA1",          DAC_ADDR_CONTROL, 0x0AA1, DAC_READ_CONTROL, 0x0AA1, 0xFFFF},
    {"Control = 0x0552",          DAC_ADDR_CONTROL, 0x0552, DAC_READ_CONTROL, 0x0552, 0xFFFF},
    // 0x0552 ha SREN = 1: con lo slew attivo il registro dati rilegge il valore intermedio
    // della rampa. Prima dei test sui dati: slew spento, range 0–10 V, uscite disabilitate.
    {"Control = 0x0001 (slew off)", DAC_ADDR_CONTROL, 0x0001, DAC_READ_CONTROL, 0x0001, 0xFFFF},
    {"Data = 0xABC (12 bit)",     DAC_ADDR_DATA,    0xABC0, DAC_READ_DATA,    0xABC0, 0xFFF0},
    {"Data = 0x543 (12 bit)",     DAC_ADDR_DATA,    0x5430, DAC_READ_DATA,    0x5430, 0xFFF0},
    {"Status (slew non attivo)",  0,                0,      DAC_READ_STATUS,  0x0000, 0xFFFF},
};

// IT: Aggiunge un passo del test al report JSON.
// EN: Appends a test step to the JSON report.
static void add_step(String &r, bool &first, const char *name, uint16_t expect, uint16_t got, bool ok) {
    char buf[128];
    snprintf(buf, sizeof(buf), "%s{\"name\":\"%s\",\"expect\":\"0x%04X\",\"read\":\"0x%04X\",\"ok\":%s}",
             first ? "" : ",", name, expect, got, ok ? "true" : "false");
    r += buf;
    first = false;
}

// IT: Test SPI con rilettura; uscite sempre disabilitate.
// EN: SPI test with readback; outputs always disabled.
bool dac_selftest(String &report) {
    DacLock lock;   // il test fa reset: disabilita anche un'uscita eventualmente attiva
    bool all_ok = true;
    bool first = true;
    int n_ffff = 0, n_0000 = 0, n_reads = 0;

    report = "{\"steps\":[";
    dac_reset();

    for (const Step &s : STEPS) {
        if (s.write_addr) dac_write(s.write_addr, s.write_val);
        uint16_t got = dac_read(s.read_addr);
        bool ok = (got & s.mask) == (s.expect & s.mask);
        all_ok &= ok;
        add_step(report, first, s.name, s.expect, got, ok);
        n_reads++;
        if (got == 0xFFFF) n_ffff++;
        if (got == 0x0000) n_0000++;
    }

    // Riporta il chip allo stato di power-on (uscite disabilitate).
    dac_reset();
    uint16_t ctrl = dac_read(DAC_READ_CONTROL);
    bool ok = ctrl == 0x0000;
    all_ok &= ok;
    add_step(report, first, "Control dopo reset finale", 0x0000, ctrl, ok);

    bool fault = dac_fault();
    all_ok &= !fault;

    // Diagnosi per i casi tipici di guasto
    const char *hint = "";
    if (n_ffff == n_reads)
        hint = "Sempre 0xFFFF: dominio COM_OUT non alimentato (isolatore a default alto) oppure SDO/percorso di ritorno interrotto";
    else if (n_0000 == n_reads)
        hint = "Sempre 0x0000: SDO bloccato basso, oppure scritture non ricevute (SCLK/SDIN/LATCH)";
    else if (!all_ok)
        hint = "Letture parziali: controllare temporizzazioni, SCLK/SDIN/LATCH e isolatore";

    report += "],\"fault\":";
    report += fault ? "true" : "false";
    report += ",\"ok\":";
    report += all_ok ? "true" : "false";
    report += ",\"hint\":\"";
    report += hint;
    report += "\"}";
    return all_ok;
}
