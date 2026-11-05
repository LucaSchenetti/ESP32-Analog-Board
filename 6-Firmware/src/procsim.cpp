/*
  IT: Simulatore di processo per la prova del PID del PLC (vedi procsim.h).
  EN: Process simulator for testing the PLC PID (see procsim.h).
*/
#include "procsim.h"

#include <math.h>
#include "adc.h"
#include "dac.h"
#include "sink.h"

static const float DT = 0.05f;                 // IT: passo di simulazione 50 ms / EN: 50 ms simulation step
static const int DEAD_MAX = 1200;              // IT: tempo morto fino a 60 s / EN: dead time up to 60 s
static const int HIST_N = 600;                 // IT: 2 minuti a 5 campioni/s / EN: 2 minutes at 5 samples/s
static const float EQ_R = 50.0f;               // IT: rangeability equipercentuale / EN: equal-percentage rangeability

static SimConfig cfg;
static SimDist dist;
static SimStatus st = {};
static volatile bool run = false;
static volatile bool want_reset = false;
static TaskHandle_t task = nullptr;
static SemaphoreHandle_t mtx = nullptr;

static float dead_buf[DEAD_MAX];
static int dead_pos = 0;
static float x1 = 0, x2 = 0;                   // IT: stati del processo / EN: process states
static float valve_ref = 0;                    // IT: riferimento dopo la banda morta / EN: reference after the dead band
static float frozen = 0;                       // IT: valore del sensore congelato / EN: frozen sensor value
static float hist[HIST_N][4];
static uint32_t hist_seq = 0;

struct Lock {
    Lock() { xSemaphoreTake(mtx, portMAX_DELAY); }
    ~Lock() { xSemaphoreGive(mtx); }
};

// IT: Numero casuale gaussiano (Box–Muller). EN: Gaussian random number (Box–Muller).
static float gauss() {
    float u1 = (esp_random() + 1.0f) / 4294967297.0f;
    float u2 = esp_random() / 4294967296.0f;
    return sqrtf(-2.0f * logf(u1)) * cosf(2.0f * (float)M_PI * u2);
}

// IT: Campo del segnale d'ingresso (min, max). EN: Input signal range (min, max).
static void in_range(float &lo, float &hi) {
    lo = cfg.in == SIM_IN_I420 ? 4.0f : 0.0f;
    hi = cfg.in == SIM_IN_V ? 10.0f : 20.0f;
}

// IT: Riporta il processo allo stato iniziale (valvola chiusa, livello al 50 %).
// EN: Resets the process to the initial state (valve closed, level at 50 %).
static void reset_state() {
    for (int k = 0; k < DEAD_MAX; k++) dead_buf[k] = 0;
    dead_pos = 0;
    x1 = x2 = 0;
    valve_ref = 0;
    st.valve = 0;
    st.pv = cfg.model == SIM_INTEG ? 50.0f : cfg.pv0;
    st.pv_meas = st.pv;
    st.drift_acc = 0;
    st.t_s = 0;
    frozen = st.pv;
}

// IT: Scrive il segnale d'uscita per una PV misurata (in %) o per il guasto attivo.
// EN: Writes the output signal for a measured PV (in %) or for the active failure.
static void write_output(float pv) {
    float sig;
    switch (st.fault) {
        case SIM_FAULT_BREAK:   // IT: filo rotto: uscita aperta / EN: broken wire: output open
            sink_disable();
            st.out_sig = 0;
            return;
        case SIM_FAULT_LOW:     // IT: guasto basso NAMUR NE 43 / EN: NAMUR NE 43 low failure
            sig = cfg.out == SIM_OUT_V || cfg.out == SIM_OUT_I020 ? 0.0f : 3.6f;
            break;
        case SIM_FAULT_HIGH:    // IT: guasto alto NAMUR NE 43 / EN: NAMUR NE 43 high failure
            sig = cfg.out == SIM_OUT_V ? 10.0f : 21.0f;
            break;
        default: {
            // IT: campo lineare NAMUR 3,8…20,5 mA per le correnti, 0…10 V per la tensione
            // EN: NAMUR linear range 3.8…20.5 mA for currents, 0…10 V for voltage
            if (cfg.out == SIM_OUT_V) sig = constrain(pv, 0.0f, 100.0f) / 10.0f;
            else if (cfg.out == SIM_OUT_I020) sig = constrain(pv, 0.0f, 102.5f) * 0.2f;
            else sig = constrain(4.0f + 0.16f * pv, 3.8f, 20.5f);
        }
    }
    st.out_sig = sig;
    if (cfg.out == SIM_OUT_V) dac_set_voltage(sig);
    else if (cfg.out == SIM_OUT_SINK) sink_set_ma(sig);
    else dac_set_current_024(sig);
}

// IT: Un passo di simulazione: MV dal PLC → valvola → processo con tempo morto → sensore con disturbi → uscita.
// EN: One simulation step: MV from the PLC → valve → process with dead time → sensor with disturbances → output.
static void step() {
    AdcReadings a = adc_get();
    float lo, hi;
    in_range(lo, hi);
    float sig = cfg.in == SIM_IN_V ? a.v_last : a.i_last;
    float mv = (sig - lo) / (hi - lo) * 100.0f;
    // IT: uscita del PLC assente o in guasto (es. filo staccato) / EN: PLC output missing or failed (e.g. wire off)
    bool bad = (cfg.in == SIM_IN_I420 && sig < 3.6f) || mv < -5.0f || mv > 110.0f;

    // IT: Valvola: banda morta (gioco), poi limite di velocità dato dal tempo di corsa
    // EN: Valve: dead band (backlash), then speed limit given by the stroke time
    float target = constrain(mv, 0.0f, 100.0f);
    float half = cfg.deadband / 2.0f;
    if (target > valve_ref + half) valve_ref = target - half;
    else if (target < valve_ref - half) valve_ref = target + half;
    float vmax = cfg.stroke > 0.05f ? 100.0f / cfg.stroke * DT : 100.0f;
    st.valve += constrain(valve_ref - st.valve, -vmax, vmax);
    st.valve = constrain(st.valve, 0.0f, 100.0f);
    float flow = st.valve;
    if (cfg.eqpct) flow = (powf(EQ_R, st.valve / 100.0f - 1.0f) - 1.0f / EQ_R) / (1.0f - 1.0f / EQ_R) * 100.0f;

    // IT: Disturbo di carico e oscillazione all'ingresso del processo / EN: Load disturbance and oscillation at the process input
    float u = flow + dist.load;
    if (dist.amp > 0 && dist.period > 0.5f) u += dist.amp * sinf(2.0f * (float)M_PI * st.t_s / dist.period);

    // IT: Tempo morto: buffer circolare / EN: Dead time: circular buffer
    int nd = constrain((int)lroundf(cfg.dead / DT), 0, DEAD_MAX - 1);
    dead_buf[dead_pos] = u;
    float ud = dead_buf[(dead_pos - nd + DEAD_MAX) % DEAD_MAX];
    dead_pos = (dead_pos + 1) % DEAD_MAX;

    // IT: Processo / EN: Process
    switch (cfg.model) {
        case SIM_INTEG:
            // IT: livello: varia con (ingresso − uscita); pieno o vuoto si ferma / EN: level: changes with (in − out); stops when full or empty
            st.pv = constrain(st.pv + DT * (cfg.gain * ud - cfg.outflow) / fmaxf(cfg.tfill, 1.0f) , 0.0f, 100.0f);
            break;
        case SIM_SECOND:
            x1 += DT / fmaxf(cfg.t1, DT) * (cfg.gain * ud - x1);
            x2 += DT / fmaxf(cfg.t2, DT) * (x1 - x2);
            st.pv = cfg.pv0 + x2;
            break;
        default:
            x1 += DT / fmaxf(cfg.t1, DT) * (cfg.gain * ud - x1);
            st.pv = cfg.pv0 + x1;
    }

    // IT: Sensore: deriva + rumore; congelato se richiesto / EN: Sensor: drift + noise; frozen if requested
    st.drift_acc += dist.drift / 60.0f * DT;
    float meas = st.pv + st.drift_acc + (cfg.noise > 0 ? cfg.noise * gauss() : 0.0f);
    if (st.fault == SIM_FAULT_FREEZE) meas = frozen;
    else frozen = meas;
    st.pv_meas = meas;
    st.mv_sig = sig;
    st.mv_pct = mv;
    st.mv_bad = bad;
    write_output(meas);
    st.t_s += DT;
}

// IT: Task a passo fisso; ogni 4 passi (200 ms) un campione nello storico. EN: Fixed-step task; a history sample every 4 steps (200 ms).
static void sim_task(void *) {
    TickType_t last = xTaskGetTickCount();
    uint32_t n = 0;
    for (;;) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(50));
        if (!run) continue;
        Lock l;
        if (want_reset) {
            reset_state();
            want_reset = false;
        }
        step();
        if (++n % 4 == 0) {
            float *h = hist[hist_seq % HIST_N];
            h[0] = st.t_s;
            h[1] = st.mv_pct;
            h[2] = st.valve;
            h[3] = st.pv_meas;
            st.seq = ++hist_seq;
        }
    }
}

// IT: Avvio o aggiornamento della configurazione. EN: Start or configuration update.
void procsim_start(const SimConfig &c, bool reset) {
    if (!mtx) mtx = xSemaphoreCreateMutex();
    {
        Lock l;
        bool out_changed = !run || c.out != cfg.out;
        cfg = c;
        cfg.dead = constrain(cfg.dead, 0.0f, (DEAD_MAX - 1) * DT);
        if (reset || !run) {
            want_reset = true;
            st.fault = SIM_FAULT_NONE;
        }
        if (out_changed) sink_disable();   // IT: cambio del tipo d'uscita: si riparte da uscite spente / EN: output type change: restart from outputs off
        adc_set_focus(cfg.in == SIM_IN_V ? 1 : 2);
        run = true;
        st.running = true;
    }
    if (!task) xTaskCreatePinnedToCore(sim_task, "sim", 4096, nullptr, 3, &task, 1);
}

// IT: Ferma e spegne le uscite. EN: Stops and switches outputs off.
void procsim_stop() {
    if (!mtx) return;
    bool was;
    {
        Lock l;
        was = run;
        run = false;
        st.running = false;
    }
    adc_set_focus(0);
    if (was) sink_disable();   // IT: GPIO38 ALTO + uscita AD5412 disabilitata / EN: GPIO38 HIGH + AD5412 output disabled
}

// IT: true se attiva. EN: true if running.
bool procsim_running() {
    return run;
}

// IT: Disturbi. EN: Disturbances.
void procsim_set_dist(const SimDist &d) {
    if (!mtx) mtx = xSemaphoreCreateMutex();
    Lock l;
    dist = d;
}

// IT: Guasto del sensore. EN: Sensor failure.
void procsim_set_fault(SimFault f) {
    if (!mtx) mtx = xSemaphoreCreateMutex();
    Lock l;
    st.fault = f;
}

// IT: Copia di configurazione, disturbi e stato. EN: Copy of configuration, disturbances and state.
void procsim_get(SimConfig &c, SimDist &d, SimStatus &s) {
    if (!mtx) mtx = xSemaphoreCreateMutex();
    Lock l;
    c = cfg;
    d = dist;
    s = st;
}

// IT: Storico dopo il campione since. EN: History after sample since.
int procsim_history(uint32_t since, float (*out)[4], int max, uint32_t &last_seq) {
    if (!mtx) mtx = xSemaphoreCreateMutex();
    Lock l;
    last_seq = hist_seq;
    uint32_t first = since + 1;
    if (hist_seq > HIST_N && first < hist_seq - HIST_N + 1) first = hist_seq - HIST_N + 1;
    int n = 0;
    for (uint32_t k = first; k <= hist_seq && n < max; k++, n++) {
        const float *h = hist[(k - 1) % HIST_N];
        for (int j = 0; j < 4; j++) out[n][j] = h[j];
    }
    return n;
}
