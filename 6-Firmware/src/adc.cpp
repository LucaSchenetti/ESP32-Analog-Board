/*
  IT: ADS1220: driver SPI, misura continua e test.
  EN: ADS1220: SPI driver, continuous measurement and self-test.
*/
#include "adc.h"

#include <SPI.h>
#include "calib.h"
#include "pins.h"

// Interfaccia (ADS1220 datasheet SBAS501D):
// - solo SPI mode 1, CPOL = 0, CPHA = 1 (§8.5.1)
// - SCLK ≥ 150 ns di periodo (tc(SC), §6.6): 1 MHz per il bring-up, margine sui ritardi dell'isolatore
// - CS attivo basso; DOUT/DRDY in alta impedenza con CS alto (§8.5.1.1)
// - DRDY dedicato (GPIO10), sempre pilotato anche con CS alto (§8.5.1.3)
// - 4 registri da 8 bit, tutti 00h dopo reset (§8.6.1)

static SPIClass adc_spi(HSPI);
static const SPISettings ADC_SPI(1000000, MSBFIRST, SPI_MODE1);

// L'ADS1220 è usato dal task di misura e dalla pagina web (self-test): ogni funzione
// pubblica prende il mutex (ricorsivo: il self-test richiama le altre).
static SemaphoreHandle_t adc_mutex;

struct AdcLock {
    AdcLock() { xSemaphoreTakeRecursive(adc_mutex, portMAX_DELAY); }
    ~AdcLock() { xSemaphoreGiveRecursive(adc_mutex); }
};

// IT: Apre una trasmissione SPI: CS basso e attesa td(CSSC).
// EN: Opens an SPI transfer: CS low and td(CSSC) wait.
static void begin_frame() {
    adc_spi.beginTransaction(ADC_SPI);
    digitalWrite(PIN_ADC_CS, LOW);
    delayMicroseconds(1);                 // td(CSSC) ≥ 50 ns
}

// IT: Chiude una trasmissione SPI: attese td(SCCS) e tw(CSH), CS alto.
// EN: Closes an SPI transfer: td(SCCS) and tw(CSH) waits, CS high.
static void end_frame() {
    delayMicroseconds(1);                 // td(SCCS) ≥ 25 ns
    digitalWrite(PIN_ADC_CS, HIGH);
    adc_spi.endTransaction();
    delayMicroseconds(1);                 // tw(CSH) ≥ 50 ns
}

// IT: Configura pin e bus SPI dell'ADS1220.
// EN: Configures the ADS1220 pins and SPI bus.
void adc_init() {
    adc_mutex = xSemaphoreCreateRecursiveMutex();
    pinMode(PIN_ADC_CS, OUTPUT);
    digitalWrite(PIN_ADC_CS, HIGH);
    pinMode(PIN_ADC_DRDY, INPUT);
    adc_spi.begin(PIN_ADC_SCLK, PIN_ADC_DOUT, PIN_ADC_DIN, -1);
}

// IT: Invia il comando RESET e attende il riavvio interno.
// EN: Sends the RESET command and waits for the internal restart.
void adc_reset() {
    AdcLock lock;
    begin_frame();
    adc_spi.transfer(ADC_CMD_RESET);
    end_frame();
    delay(1);                             // ≥ 50 µs + 32 tCLK (§8.5.3.1)
}

// IT: Legge i 4 registri di configurazione (RREG).
// EN: Reads the 4 configuration registers (RREG).
void adc_read_regs(uint8_t regs[4]) {
    AdcLock lock;
    begin_frame();
    adc_spi.transfer(ADC_CMD_RREG | (0 << 2) | 3);   // da reg 0, 4 byte
    for (int i = 0; i < 4; i++) regs[i] = adc_spi.transfer(0x00);
    end_frame();
}

// IT: Scrive i 4 registri di configurazione (WREG).
// EN: Writes the 4 configuration registers (WREG).
void adc_write_regs(const uint8_t regs[4]) {
    AdcLock lock;
    begin_frame();
    adc_spi.transfer(ADC_CMD_WREG | (0 << 2) | 3);
    for (int i = 0; i < 4; i++) adc_spi.transfer(regs[i]);
    end_frame();
}

// IT: Esegue una conversione single-shot con la configurazione data e legge il risultato.
// EN: Runs one single-shot conversion with the given configuration and reads the result.
// Conversione single-shot con la configurazione data: WREG, START/SYNC, attesa DRDY (GPIO10),
// RDATA. A 20 SPS la conversione dura 204850 tCLK = 50,0 ms (Tabella 8-4).
static bool convert(const uint8_t regs[4], int32_t &code, uint32_t &conv_ms) {
    AdcLock lock;
    adc_write_regs(regs);

    begin_frame();
    adc_spi.transfer(ADC_CMD_START);
    end_frame();

    uint32_t t0 = millis();
    while (digitalRead(PIN_ADC_DRDY) == HIGH) {
        if (millis() - t0 > 250) return false;
        delay(1);
    }
    conv_ms = millis() - t0;

    begin_frame();
    adc_spi.transfer(ADC_CMD_RDATA);
    uint32_t raw = 0;
    for (int i = 0; i < 3; i++) raw = (raw << 8) | adc_spi.transfer(0x00);
    end_frame();

    code = (raw & 0x800000) ? (int32_t)(raw | 0xFF000000) : (int32_t)raw;   // 24 bit, complemento a due
    return true;
}

// IT: Converte il sensore di temperatura interno in °C.
// EN: Converts the internal temperature sensor to °C.
bool adc_read_temperature(float &temp_c, uint32_t &conv_ms) {
    const uint8_t regs[4] = {0x00, 0x02, 0x00, 0x00};   // reg1: TS = 1, 20 SPS, single-shot
    int32_t code;
    if (!convert(regs, code, conv_ms)) return false;

    // 14 bit in complemento a due, allineati a sinistra; 1 LSB = 0,03125 °C (§8.3.13, Tabella 8-5)
    int32_t t14 = code >> 10;   // shift aritmetico: il segno è già esteso
    temp_c = t14 * 0.03125f;
    return true;
}

// ── Misura continua ─────────────────────────────────────────────────────────
// Schema "2 - 4 WIRE RECEIVER":
//   corrente: mA+ → F3 → shunt R34 25,5 Ω 0,05% → COM_IN; AIN0/AIN1 ai capi dello shunt
//             tramite R30/R35 4,12 kΩ
//   tensione: V+ → R40 90,9 kΩ → AIN2, R42 10 kΩ verso COM_IN; AIN3 → R43 9,09 kΩ → COM_IN
//             (9,09 kΩ ≈ 90,9 kΩ ∥ 10 kΩ: impedenze bilanciate sui due ingressi)
// Configurazione (Tabelle 8-10, 8-11, 8-13):
//   reg0 corrente: MUX 0000 (AIN0–AIN1), GAIN 2, PGA bypass → 0x03  FS ±1,024 V → ±40,2 mA
//   reg0 tensione: MUX 0101 (AIN2–AIN3), GAIN 1, PGA bypass → 0x51  FS ±2,048 V → ±20,7 V
//   Il PGA bypassato ammette il modo comune fino a AVSS − 0,1 V (§8.6.2.1): gli ingressi sono a ~0 V.
//   reg1: 20 SPS, modo normale, single-shot                → 0x00
//   reg2: riferimento interno 2,048 V, filtro 50+60 Hz     → 0x10  (NMRR 90 dB con CLK esterno, §6.5)
//   reg3: IDAC spenti, DRDYM = 0 (c'è il DRDY dedicato)    → 0x00
static const uint8_t REG_I[4] = {0x03, 0x00, 0x10, 0x00};
static const uint8_t REG_V[4] = {0x51, 0x00, 0x10, 0x00};

static const float VREF = 2.048f;                    // interno, 2,045–2,051 V a 25 °C (§6.5)
static const float FS_CODES = 8388608.0f;            // 2^23
static const float R_SHUNT = 25.5f;                  // R34
static const float V_DIV = (90900.0f + 10000.0f) / 10000.0f;   // R40, R42 → 10,09

static const int AVG_N = 10;                         // media mobile: ~1 s per canale
static SemaphoreHandle_t data_mutex;
static AdcReadings data = {};
static float buf_v[AVG_N], buf_i[AVG_N];
static int buf_pos = 0, buf_count = 0;
static volatile uint8_t focus = 0;   // IT: 0 alterna, 1 solo V, 2 solo I / EN: 0 alternate, 1 V only, 2 I only

// IT: Imposta il canale prioritario. EN: Sets the focus channel.
void adc_set_focus(uint8_t ch) {
    focus = ch <= 2 ? ch : 0;
}

// IT: Calcola media, minimo e massimo di un buffer.
// EN: Computes mean, minimum and maximum of a buffer.
static void stats(const float *b, int n, float &mean, float &mn, float &mx) {
    mean = 0; mn = b[0]; mx = b[0];
    for (int k = 0; k < n; k++) {
        mean += b[k];
        mn = min(mn, b[k]);
        mx = max(mx, b[k]);
    }
    mean /= n;
}

// IT: Task di misura: alterna tensione e corrente, aggiorna medie e flag di fuori scala.
// EN: Measurement task: alternates voltage and current, updates averages and over-range flags.
static void adc_task(void *) {
    uint32_t cycle = 0;
    for (;;) {
        int32_t cv = 0, ci = 0;
        uint32_t ms;
        uint8_t f = focus;
        // IT: con un canale prioritario l'altro non viene convertito e resta al valore precedente
        // EN: with a focus channel the other one is not converted and keeps its previous value
        if (f == 1) ci = data.code_i;
        if (f == 2) cv = data.code_v;
        bool ok = (f == 2 || convert(REG_V, cv, ms)) && (f == 1 || convert(REG_I, ci, ms));

        float temp = NAN;
        if (ok && cycle % 20 == 0) adc_read_temperature(temp, ms);   // ~ogni 2 s

        xSemaphoreTake(data_mutex, portMAX_DELAY);
        if (ok) {
            buf_v[buf_pos] = cv * VREF / (1 * FS_CODES) * V_DIV;
            buf_i[buf_pos] = ci * VREF / (2 * FS_CODES) / R_SHUNT * 1000.0f;
            data.v_last = calib_apply(CAL_VIN, buf_v[buf_pos]);
            data.i_last = calib_apply(CAL_IIN, buf_i[buf_pos]);
            buf_pos = (buf_pos + 1) % AVG_N;
            if (buf_count < AVG_N) buf_count++;
            stats(buf_v, buf_count, data.v, data.v_min, data.v_max);
            stats(buf_i, buf_count, data.i_ma, data.i_min, data.i_max);
            data.v_nom = data.v;
            data.i_nom = data.i_ma;
            data.v = calib_apply(CAL_VIN, data.v);
            data.v_min = calib_apply(CAL_VIN, data.v_min);
            data.v_max = calib_apply(CAL_VIN, data.v_max);
            data.i_ma = calib_apply(CAL_IIN, data.i_ma);
            data.i_min = calib_apply(CAL_IIN, data.i_min);
            data.i_max = calib_apply(CAL_IIN, data.i_max);
            data.code_v = cv;
            data.code_i = ci;
            // Oltre il fondo scala il codice si blocca a 7FFFFFh / 800000h (§8.4.1, Tabella 8-6)
            data.sat_v = cv >= 0x7FFFFF || cv <= -0x800000;
            data.sat_i = ci >= 0x7FFFFF || ci <= -0x800000;
            data.n++;
            if (!isnan(temp)) data.temp_c = temp;
        } else {
            data.errors++;
        }
        xSemaphoreGive(data_mutex);

        cycle++;
        vTaskDelay(1);
    }
}

// IT: Crea il mutex dei dati e avvia il task di misura sul core 1.
// EN: Creates the data mutex and starts the measurement task on core 1.
void adc_measure_start() {
    data_mutex = xSemaphoreCreateMutex();
    data.temp_c = NAN;
    // Core 1: separato da WiFi/AsyncTCP (core 0).
    xTaskCreatePinnedToCore(adc_task, "adc", 4096, nullptr, 2, nullptr, 1);
}

// IT: Copia le ultime misure sotto mutex.
// EN: Copies the latest readings under mutex.
AdcReadings adc_get() {
    AdcReadings r;
    xSemaphoreTake(data_mutex, portMAX_DELAY);
    r = data;
    xSemaphoreGive(data_mutex);
    return r;
}

// ── Test ────────────────────────────────────────────────────────────────────

// Configurazioni di prova: nessun IDAC (reg2 bit 2:0 = 0, reg3 I1MUX/I2MUX = 0),
// BCS = 0 (reg1 bit 0), PSW = 0 (reg2 bit 3), bit riservato reg3 bit 0 = 0.
// Nessuna conversione viene avviata: cambiano solo i valori nei registri.
static const uint8_t PATTERN_A[4] = {0xA5, 0x40, 0x40, 0x02};
static const uint8_t PATTERN_B[4] = {0x5A, 0xA0, 0x80, 0x00};

// IT: Aggiunge un passo del test al report JSON.
// EN: Appends a test step to the JSON report.
static void add_step(String &r, bool &first, const char *name, const uint8_t exp[4],
                     const uint8_t got[4], bool ok) {
    char buf[160];
    snprintf(buf, sizeof(buf),
             "%s{\"name\":\"%s\",\"expect\":\"%02X %02X %02X %02X\",\"read\":\"%02X %02X %02X %02X\",\"ok\":%s}",
             first ? "" : ",", name, exp[0], exp[1], exp[2], exp[3], got[0], got[1], got[2], got[3],
             ok ? "true" : "false");
    r += buf;
    first = false;
}

// IT: Test SPI con rilettura dei registri e conversione di temperatura.
// EN: SPI test with register readback and a temperature conversion.
bool adc_selftest(String &report) {
    AdcLock lock;   // il task di misura attende; ogni sua conversione riscrive tutti i registri
    static const uint8_t ZERO[4] = {0, 0, 0, 0};
    bool all_ok = true, first = true;
    int n_ff = 0, n_00 = 0, n_reads = 0;
    uint8_t got[4];

    auto check = [&](const char *name, const uint8_t exp[4]) {
        adc_read_regs(got);
        bool ok = memcmp(got, exp, 4) == 0;
        all_ok &= ok;
        add_step(report, first, name, exp, got, ok);
        n_reads++;
        if (got[0] == 0xFF && got[1] == 0xFF && got[2] == 0xFF && got[3] == 0xFF) n_ff++;
        if (memcmp(got, ZERO, 4) == 0) n_00++;
    };

    report = "{\"steps\":[";
    adc_reset();
    check("Registri dopo reset", ZERO);
    adc_write_regs(PATTERN_A);
    check("Scrivi A5 40 40 02", PATTERN_A);
    adc_write_regs(PATTERN_B);
    check("Scrivi 5A A0 80 00", PATTERN_B);
    adc_reset();
    check("Registri dopo reset finale", ZERO);

    float temp = NAN;
    uint32_t conv_ms = 0;
    bool drdy_ok = adc_read_temperature(temp, conv_ms);
    bool temp_ok = drdy_ok && temp > 0.0f && temp < 70.0f;
    all_ok &= temp_ok;
    adc_reset();

    const char *hint = "";
    if (n_ff == n_reads)
        hint = "Sempre FF: dominio COM_IN non alimentato (isolatore a default alto) oppure DOUT/percorso di ritorno interrotto";
    else if (n_00 == n_reads)
        hint = "Sempre 00: DOUT bloccato basso, oppure scritture non ricevute (SCLK/DIN/CS)";
    else if (!drdy_ok)
        hint = "Registri OK ma DRDY non scende: controllare GPIO10 e il secondo canale di ritorno dell'isolatore";
    else if (!temp_ok)
        hint = "Temperatura fuori range 0-70 °C: conversione sospetta";
    else if (!all_ok)
        hint = "Letture parziali: controllare temporizzazioni, SCLK/DIN/CS e isolatore";

    char tail[200];
    snprintf(tail, sizeof(tail),
             "],\"drdy\":%s,\"temp_c\":%.2f,\"conv_ms\":%lu,\"ok\":%s,\"hint\":\"",
             drdy_ok ? "true" : "false", drdy_ok ? temp : 0.0f, (unsigned long)conv_ms,
             all_ok ? "true" : "false");
    report += tail;
    report += hint;
    report += "\"}";
    return all_ok;
}
