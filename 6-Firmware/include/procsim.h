#pragma once
/*
  Simulatore di processo / Process simulator
  IT: Prova "hardware in the loop" del PID del PLC. L'uscita del PLC (MV) entra su P2, passa per una valvola
      simulata (tempo di corsa, banda morta, caratteristica) e per un processo simulato (primo ordine, secondo
      ordine o integratore come un livello, con tempo morto); il valore di processo (PV) esce su P1 come un
      sensore in campo, con rumore, disturbi di carico, oscillazione, deriva e guasti del sensore.
      Task a passo fisso di 50 ms (core 1); durante la simulazione l'ADC legge solo il canale dell'MV.
  EN: "Hardware in the loop" test of the PLC PID. The PLC output (MV) enters on P2, goes through a simulated
      valve (stroke time, dead band, characteristic) and a simulated process (first order, second order or
      integrating like a level, with dead time); the process value (PV) leaves on P1 like a field sensor, with
      noise, load disturbances, oscillation, drift and sensor failures.
      Fixed 50 ms step task (core 1); during the simulation the ADC reads only the MV channel.
*/

#include <Arduino.h>

// IT: Modello del processo. EN: Process model.
enum SimModel : uint8_t { SIM_FIRST = 0, SIM_SECOND = 1, SIM_INTEG = 2 };
// IT: Segnale d'ingresso (uscita del PLC). EN: Input signal (PLC output).
enum SimIn : uint8_t { SIM_IN_V = 0, SIM_IN_I420 = 1, SIM_IN_I020 = 2 };
// IT: Segnale d'uscita (ingresso del PLC). EN: Output signal (PLC input).
enum SimOut : uint8_t { SIM_OUT_V = 0, SIM_OUT_I420 = 1, SIM_OUT_I020 = 2, SIM_OUT_SINK = 3 };
// IT: Guasto del sensore simulato. EN: Simulated sensor failure.
enum SimFault : uint8_t { SIM_FAULT_NONE = 0, SIM_FAULT_BREAK, SIM_FAULT_LOW, SIM_FAULT_HIGH, SIM_FAULT_FREEZE };

// IT: Configurazione (valori in % del campo, tempi in s). EN: Configuration (values in % of range, times in s).
struct SimConfig {
    SimModel model = SIM_FIRST;
    float gain = 1.0f;      // IT: guadagno del processo (% PV / % valvola) / EN: process gain
    float t1 = 10.0f;       // IT: costante di tempo principale / EN: main time constant
    float t2 = 3.0f;        // IT: seconda costante (secondo ordine) / EN: second time constant (second order)
    float dead = 2.0f;      // IT: tempo morto (0…60 s) / EN: dead time (0…60 s)
    float tfill = 60.0f;    // IT: integratore: tempo di riempimento 0→100 % con portata netta 100 % / EN: integrating: fill time
    float outflow = 50.0f;  // IT: integratore: portata in uscita (%) / EN: integrating: outflow (%)
    float pv0 = 0.0f;       // IT: PV con valvola chiusa (%) / EN: PV with closed valve (%)
    float stroke = 5.0f;    // IT: tempo di corsa della valvola 0→100 % / EN: valve stroke time 0→100 %
    float deadband = 0.5f;  // IT: banda morta della valvola (%) / EN: valve dead band (%)
    bool eqpct = false;     // IT: caratteristica equipercentuale / EN: equal-percentage characteristic
    float noise = 0.2f;     // IT: rumore di misura, deviazione standard (%) / EN: measurement noise, standard deviation (%)
    SimIn in = SIM_IN_I420;
    SimOut out = SIM_OUT_I420;
};

// IT: Disturbi (modificabili durante la simulazione). EN: Disturbances (changeable during the simulation).
struct SimDist {
    float load = 0.0f;      // IT: disturbo di carico all'ingresso del processo (%) / EN: load disturbance at process input (%)
    float amp = 0.0f;       // IT: oscillazione: ampiezza (%) / EN: oscillation: amplitude (%)
    float period = 30.0f;   // IT: oscillazione: periodo (s) / EN: oscillation: period (s)
    float drift = 0.0f;     // IT: deriva del sensore (%/min) / EN: sensor drift (%/min)
};

// IT: Stato istantaneo. EN: Instant state.
struct SimStatus {
    bool running;
    float t_s;              // IT: tempo dall'avvio / EN: time since start
    float mv_sig, mv_pct;   // IT: uscita del PLC (V o mA, %) / EN: PLC output
    bool mv_bad;            // IT: segnale del PLC fuori campo (es. < 3,6 mA) / EN: PLC signal out of range
    float valve;            // IT: posizione della valvola (%) / EN: valve position (%)
    float pv;               // IT: valore vero del processo (%) / EN: true process value (%)
    float pv_meas;          // IT: valore misurato dal sensore simulato (%) / EN: value measured by the simulated sensor (%)
    float out_sig;          // IT: segnale in uscita (V o mA) / EN: output signal (V or mA)
    float drift_acc;        // IT: deriva accumulata (%) / EN: accumulated drift (%)
    SimFault fault;
    uint32_t seq;           // IT: numero dell'ultimo campione di storico / EN: number of the last history sample
};

// IT: Avvia la simulazione (reset = riparte da capo) o aggiorna la configurazione al volo.
// EN: Starts the simulation (reset = restarts from scratch) or updates the configuration on the fly.
void procsim_start(const SimConfig &cfg, bool reset);
// IT: Ferma la simulazione e spegne le uscite. EN: Stops the simulation and switches the outputs off.
void procsim_stop();
// IT: true se la simulazione è attiva. EN: true if the simulation is running.
bool procsim_running();
// IT: Imposta i disturbi. EN: Sets the disturbances.
void procsim_set_dist(const SimDist &d);
// IT: Imposta il guasto del sensore. EN: Sets the sensor failure.
void procsim_set_fault(SimFault f);
// IT: Configurazione, disturbi e stato attuali. EN: Current configuration, disturbances and state.
void procsim_get(SimConfig &cfg, SimDist &dist, SimStatus &st);
// IT: Storico a 5 campioni/s (ultimi 2 minuti): copia in out i campioni con numero > since, al massimo max.
//     Ogni campione: tempo (s), MV %, valvola %, PV misurata %. Restituisce quanti campioni ha copiato.
// EN: History at 5 samples/s (last 2 minutes): copies into out the samples numbered > since, at most max.
//     Each sample: time (s), MV %, valve %, measured PV %. Returns how many samples were copied.
int procsim_history(uint32_t since, float (*out)[4], int max, uint32_t &last_seq);
