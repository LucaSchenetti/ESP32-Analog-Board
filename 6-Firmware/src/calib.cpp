/*
  IT: Calibrazione: coefficienti in NVS, correzioni, procedure a due punti e in loopback.
  EN: Calibration: NVS coefficients, corrections, two-point and loopback procedures.
*/
#include "calib.h"

#include <Preferences.h>
#include "adc.h"
#include "dac.h"
#include "procsim.h"
#include "sink.h"

static const char *NVS_NS = "calib";
// Prefissi delle chiavi NVS: quelli del sink sono gli stessi della prima versione (rev.15),
// così la calibrazione già salvata resta valida.
static const char *KEY[CAL_N] = {"sink", "vout", "iout", "vin", "iin"};
static const char *UNIT[CAL_N] = {"mA", "V", "mA", "V", "mA"};
static CalCoeff cal[CAL_N];

// IT: Compone la chiave NVS di un canale (es. "vout_g").
// EN: Builds a channel NVS key (e.g. "vout_g").
static String key(CalChannel ch, const char *suffix) {
    return String(KEY[ch]) + suffix;
}

// IT: Legge tutti i coefficienti dalla NVS.
// EN: Reads all coefficients from NVS.
void calib_load() {
    Preferences p;
    p.begin(NVS_NS, true);
    for (int i = 0; i < CAL_N; i++) {
        CalChannel ch = (CalChannel)i;
        CalCoeff c;
        c.valid = p.getBool(key(ch, "_ok").c_str(), false);
        if (c.valid) {
            c.gain = p.getFloat(key(ch, "_g").c_str(), 1.0f);
            c.offset = p.getFloat(key(ch, "_o").c_str(), 0.0f);
            c.date = p.getULong(key(ch, "_t").c_str(), 0);
            c.temp_c = p.getFloat(key(ch, "_c").c_str(), NAN);
        }
        cal[i] = c.valid ? c : CalCoeff();
    }
    p.end();
}

// IT: Restituisce i coefficienti di un canale.
// EN: Returns a channel's coefficients.
CalCoeff calib_get(CalChannel ch) {
    return cal[ch];
}

// IT: Restituisce l'unità del canale.
// EN: Returns the channel unit.
const char *calib_unit(CalChannel ch) {
    return UNIT[ch];
}

// IT: Salva i coefficienti di un canale in NVS e in memoria.
// EN: Saves a channel's coefficients to NVS and RAM.
static void save(CalChannel ch, const CalCoeff &c) {
    Preferences p;
    p.begin(NVS_NS, false);
    p.putBool(key(ch, "_ok").c_str(), c.valid);
    p.putFloat(key(ch, "_g").c_str(), c.gain);
    p.putFloat(key(ch, "_o").c_str(), c.offset);
    p.putULong(key(ch, "_t").c_str(), c.date);
    p.putFloat(key(ch, "_c").c_str(), c.temp_c);
    p.end();
    cal[ch] = c;
}

// IT: Cancella la calibrazione di un canale.
// EN: Clears a channel's calibration.
void calib_clear(CalChannel ch) {
    save(ch, CalCoeff());
}

// IT: Corregge un valore nominale (ingressi).
// EN: Corrects a nominal value (inputs).
float calib_apply(CalChannel ch, float nominal) {
    const CalCoeff &c = cal[ch];
    return c.valid ? c.gain * nominal + c.offset : nominal;
}

// IT: Valore nominale da impostare per ottenere quello voluto (uscite).
// EN: Nominal value to set to obtain the wanted one (outputs).
float calib_inverse(CalChannel ch, float target) {
    const CalCoeff &c = cal[ch];
    return c.valid ? (target - c.offset) / c.gain : target;
}

// Limiti di plausibilità: oltre, il risultato indica un collegamento sbagliato o un guasto.
static const float GAIN_TOL = 0.05f;                                     // ±5%
static const float OFFSET_MAX[CAL_N] = {0.5f, 0.2f, 0.5f, 0.2f, 0.5f};    // V o mA

// IT: Temperatura attuale dell'ADS1220.
// EN: Current ADS1220 temperature.
static float temp_now() {
    return adc_get().temp_c;
}

// ── Ingressi: due punti con riferimento esterno ─────────────────────────────

// IT: Calcola e salva i coefficienti di un ingresso da due punti di riferimento.
// EN: Computes and saves input coefficients from two reference points.
bool calib_input_two_point(CalChannel ch, float meas1, float ref1, float meas2, float ref2,
                           uint32_t epoch, String &err) {
    if (ch != CAL_VIN && ch != CAL_IIN) {
        err = "canale non di ingresso";
        return false;
    }
    // Punti distanti almeno il 20% del campo (10 V / 20 mA), altrimenti il guadagno è mal condizionato.
    float min_span = ch == CAL_VIN ? 2.0f : 4.0f;
    if (fabsf(ref2 - ref1) < min_span || fabsf(meas2 - meas1) < min_span) {
        err = String("punti troppo vicini (minimo ") + min_span + " " + UNIT[ch] + ")";
        return false;
    }
    CalCoeff c;
    c.gain = (ref2 - ref1) / (meas2 - meas1);
    c.offset = ref1 - c.gain * meas1;
    c.date = epoch;
    c.temp_c = temp_now();
    c.valid = true;
    if (fabsf(c.gain - 1.0f) > GAIN_TOL || fabsf(c.offset) > OFFSET_MAX[ch]) {
        char buf[96];
        snprintf(buf, sizeof(buf), "coefficienti fuori limite (gain %.4f, offset %.4f %s): non salvati",
                 c.gain, c.offset, UNIT[ch]);
        err = buf;
        return false;
    }
    save(ch, c);
    return true;
}

// ── Uscite: procedura automatica in loopback ────────────────────────────────

static const int N_PTS = 5;
static const int N_VER = 3;

struct OutDesc {
    float pts[N_PTS];
    float ver[N_VER];
    float first_lo, first_hi;           // plausibilità della prima misura: collegamento giusto?
    void (*set_raw)(float);             // valore nominale, senza calibrazione
    void (*set_cal)(float);             // valore voluto, con calibrazione
    float (*nominal)();                 // valore nominale effettivamente impostato
    bool (*on)();                       // uscita ancora attiva?
    bool measure_v;                     // misura dall'ingresso tensione (altrimenti corrente)
};

// IT: Adattatore: sink nominale.
// EN: Adapter: nominal sink.
static void sink_raw(float x) { sink_set_ma_raw(x); }
// IT: Adattatore: sink calibrato.
// EN: Adapter: calibrated sink.
static void sink_cal(float x) { sink_set_ma(x); }
// IT: Adattatore: corrente nominale del sink.
// EN: Adapter: nominal sink current.
static float sink_nom() { return sink_setpoint_ma(); }
// IT: Adattatore: sink abilitato?
// EN: Adapter: sink enabled?
static bool sink_on() { return sink_enabled(); }

// IT: Adattatore: tensione nominale.
// EN: Adapter: nominal voltage.
static void vout_raw(float x) { dac_set_voltage_raw(x); }
// IT: Adattatore: tensione calibrata.
// EN: Adapter: calibrated voltage.
static void vout_cal(float x) { dac_set_voltage(x); }
// IT: Adattatore: corrente nominale.
// EN: Adapter: nominal current.
static void iout_raw(float x) { dac_set_current_raw(x); }
// IT: Adattatore: corrente calibrata.
// EN: Adapter: calibrated current.
static void iout_cal(float x) { dac_set_current(x); }
// IT: Adattatore: valore nominale dell'uscita AD5412.
// EN: Adapter: nominal AD5412 output value.
static float dac_nom() { return dac_out_status().theory; }
// IT: Adattatore: uscita tensione attiva?
// EN: Adapter: voltage output active?
static bool vout_on() { return dac_out_status().mode == DAC_OUT_V_0_10; }
// IT: Adattatore: uscita corrente attiva?
// EN: Adapter: current output active?
static bool iout_on() { return dac_out_status().mode == DAC_OUT_I_4_20; }

static const OutDesc DESC[3] = {
    // SINK
    {{4, 8, 12, 16, 20}, {4, 12, 20}, 3.0f, 5.0f, sink_raw, sink_cal, sink_nom, sink_on, false},
    // VOUT: 1…9 V, lontano da 0 V (offset) e dal fondo scala
    {{1, 3, 5, 7, 9}, {1, 5, 9}, 0.8f, 1.2f, vout_raw, vout_cal, dac_nom, vout_on, true},
    // IOUT
    {{4, 8, 12, 16, 20}, {4, 12, 20}, 3.0f, 5.0f, iout_raw, iout_cal, dac_nom, iout_on, false},
};

struct CalState {
    CalChannel ch = CAL_SINK;
    bool running = false;
    bool done = false;
    bool ok = false;
    String step;
    String msg;
    const char *code = "";   // IT: codice d'errore per l'interfaccia / EN: error code for the interface
    int n_pts = 0, n_ver = 0;
    float th[N_PTS], meas[N_PTS];
    float ver_target[N_VER], ver_meas[N_VER];
};

static CalState st;
static SemaphoreHandle_t st_mutex;
static uint32_t cal_epoch;

struct StLock {
    StLock() { xSemaphoreTake(st_mutex, portMAX_DELAY); }
    ~StLock() { xSemaphoreGive(st_mutex); }
};

// IT: Crea il mutex dello stato al primo uso.
// EN: Creates the state mutex on first use.
static void ensure_mutex() {
    if (!st_mutex) st_mutex = xSemaphoreCreateMutex();
}

// IT: Aggiorna la descrizione del passo in corso.
// EN: Updates the current step description.
static void set_step(const char *s) {
    StLock l;
    st.step = s;
}

// IT: Attende 10 nuove letture dell'ADS1220 e restituisce la media.
// EN: Waits for 10 new ADS1220 readings and returns the average.
// Media di 10 letture tutte successive alla chiamata (~1,3 s a 20 SPS con V e I alternati).
static bool fresh_reading(bool voltage, float &val) {
    vTaskDelay(pdMS_TO_TICKS(500));                  // assestamento uscita + filtro RC d'ingresso
    uint32_t n0 = adc_get().n;
    uint32_t t0 = millis();
    while (adc_get().n < n0 + 12) {
        if (millis() - t0 > 5000) return false;
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    AdcReadings r = adc_get();
    val = voltage ? r.v : r.i_ma;
    return true;
}

// IT: Termina la procedura: uscite spente, esito registrato.
// EN: Ends the procedure: outputs off, result recorded.
static void finish(bool ok, const String &msg, const char *code = "") {
    sink_disable();   // GPIO38 ALTO + uscita AD5412 disabilitata, qualunque sia il canale
    StLock l;
    st.ok = ok;
    st.code = code;
    st.msg = msg;
    st.step = ok ? "completata" : "interrotta";
    st.running = false;
    st.done = true;
}

// IT: Termina il task con errore (non ritorna). code: timeout, off, wiring, limits, verify.
// EN: Ends the task with an error (does not return). code: timeout, off, wiring, limits, verify.
static void fail(const char *code, const char *msg) {
    finish(false, msg, code);
    vTaskDelete(nullptr);
}

// IT: Task di calibrazione: 5 punti, retta ai minimi quadrati, salvataggio, verifica.
// EN: Calibration task: 5 points, least-squares line, save, verification.
static void cal_task(void *) {
    const CalChannel ch = st.ch;
    const OutDesc &d = DESC[ch];
    const char *u = UNIT[ch];
    char buf[112];

    // 1. Punti senza correzione
    for (int k = 0; k < N_PTS; k++) {
        snprintf(buf, sizeof(buf), "misura %d/%d: %g %s", k + 1, N_PTS, d.pts[k], u);
        set_step(buf);
        d.set_raw(d.pts[k]);
        float th = d.nominal();
        float m;
        if (!fresh_reading(d.measure_v, m)) return fail("timeout", "ADS1220 non risponde (timeout)");
        if (!d.on()) return fail("off", "uscita spenta durante la misura (WiFi scollegato o comando esterno)");
        if (k == 0 && (m < d.first_lo || m > d.first_hi)) {
            snprintf(buf, sizeof(buf), "a %g %s l'ingresso legge %.4f %s: controllare il collegamento",
                     d.pts[0], u, m, u);
            return fail("wiring", buf);
        }
        StLock l;
        st.th[k] = th;
        st.meas[k] = m;
        st.n_pts = k + 1;
    }

    // 2. Retta ai minimi quadrati: meas = gain × th + offset
    float sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (int k = 0; k < N_PTS; k++) {
        sx += st.th[k]; sy += st.meas[k];
        sxx += st.th[k] * st.th[k]; sxy += st.th[k] * st.meas[k];
    }
    CalCoeff c;
    c.gain = (N_PTS * sxy - sx * sy) / (N_PTS * sxx - sx * sx);
    c.offset = (sy - c.gain * sx) / N_PTS;
    c.date = cal_epoch;
    c.temp_c = temp_now();
    c.valid = true;
    if (fabsf(c.gain - 1.0f) > GAIN_TOL || fabsf(c.offset) > OFFSET_MAX[ch]) {
        snprintf(buf, sizeof(buf), "coefficienti fuori limite (gain %.4f, offset %.4f %s): non salvati",
                 c.gain, c.offset, u);
        return fail("limits", buf);
    }
    save(ch, c);

    // 3. Verifica con la correzione applicata
    for (int k = 0; k < N_VER; k++) {
        snprintf(buf, sizeof(buf), "verifica %d/%d: %g %s", k + 1, N_VER, d.ver[k], u);
        set_step(buf);
        d.set_cal(d.ver[k]);
        float m;
        if (!fresh_reading(d.measure_v, m) || !d.on())
            return fail("verify", "verifica interrotta (coefficienti già salvati)");
        StLock l;
        st.ver_target[k] = d.ver[k];
        st.ver_meas[k] = m;
        st.n_ver = k + 1;
    }

    finish(true, "coefficienti salvati in NVS");
    vTaskDelete(nullptr);
}

// IT: Avvia la calibrazione in loopback di un'uscita.
// EN: Starts the loopback calibration of an output.
bool calib_output_start(CalChannel ch, uint32_t epoch) {
    if (ch != CAL_SINK && ch != CAL_VOUT && ch != CAL_IOUT) return false;
    ensure_mutex();
    {
        StLock l;
        if (st.running) return false;
        st = CalState();
        st.ch = ch;
        st.running = true;
        st.step = "avvio";
    }
    cal_epoch = epoch;
    procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
    sink_disable();   // si parte sempre da uscite spente
    xTaskCreatePinnedToCore(cal_task, "cal", 4096, nullptr, 1, nullptr, 1);
    return true;
}

// IT: Esito dell'ultima procedura automatica.
// EN: Result of the last automatic procedure.
bool calib_last_ok() {
    ensure_mutex();
    StLock l;
    return st.ok;
}

// IT: true durante una calibrazione.
// EN: true during a calibration.
bool calib_running() {
    ensure_mutex();
    StLock l;
    return st.running;
}

// IT: Stato della procedura e coefficienti in JSON.
// EN: Procedure state and coefficients as JSON.
String calib_status_json() {
    ensure_mutex();
    StLock l;
    char buf[200];
    String j = "{\"ch\":\"";
    j += KEY[st.ch];
    j += "\",\"unit\":\"";
    j += UNIT[st.ch];
    j += "\",\"running\":";
    j += st.running ? "true" : "false";
    j += ",\"done\":";
    j += st.done ? "true" : "false";
    j += ",\"ok\":";
    j += st.ok ? "true" : "false";
    j += ",\"code\":\"";
    j += st.code;
    j += "\",\"step\":\"" + st.step + "\",\"msg\":\"" + st.msg + "\",\"pts\":[";
    for (int k = 0; k < st.n_pts; k++) {
        snprintf(buf, sizeof(buf), "%s{\"set\":%g,\"th\":%.4f,\"meas\":%.4f}", k ? "," : "",
                 DESC[st.ch].pts[k], st.th[k], st.meas[k]);
        j += buf;
    }
    j += "],\"ver\":[";
    for (int k = 0; k < st.n_ver; k++) {
        snprintf(buf, sizeof(buf), "%s{\"target\":%g,\"meas\":%.4f}", k ? "," : "",
                 st.ver_target[k], st.ver_meas[k]);
        j += buf;
    }
    const CalCoeff &c = cal[st.ch];
    char temp[16] = "null";
    if (!isnan(c.temp_c)) snprintf(temp, sizeof(temp), "%.2f", c.temp_c);
    snprintf(buf, sizeof(buf),
             "],\"cal\":{\"valid\":%s,\"gain\":%.6f,\"offset\":%.5f,\"date\":%lu,\"temp\":%s}}",
             c.valid ? "true" : "false", c.gain, c.offset, (unsigned long)c.date, temp);
    j += buf;
    return j;
}
