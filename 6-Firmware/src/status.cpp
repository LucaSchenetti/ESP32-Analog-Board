/*
  IT: LED RGB e cicalino secondo lo stato dello strumento (vedi status.h).
  EN: RGB LED and buzzer driven by the instrument state (see status.h).
*/
#include "status.h"

#include <Arduino.h>
#include <WiFi.h>
#include "buzzer.h"
#include "calib.h"
#include "dac.h"
#include "leds.h"
#include "procsim.h"
#include "sink.h"
#include "sysinfo.h"

// Colori (PWM 0…255). Il rosso ha 180 Ω, verde e blu 47 Ω: l'arancio usa poco verde
// per non sembrare giallo. Valori da ritoccare a occhio sulla scheda.
struct Rgb { uint8_t r, g, b; };
static const Rgb C_GREEN   = {0, 40, 0};      // IT: ridotto su richiesta (era 160) / EN: reduced on request (was 160)
static const Rgb C_AMBER   = {255, 45, 0};
static const Rgb C_RED     = {255, 0, 0};
static const Rgb C_BLUE    = {0, 0, 255};
static const Rgb C_MAGENTA = {255, 0, 200};
static const Rgb C_PURPLE  = {90, 0, 255};     // IT: simulatore di processo (colore della sezione Prove) / EN: process simulator
static const Rgb C_OFF     = {0, 0, 0};

static const uint32_t TICK_MS = 20;
static const uint32_t FAULT_REPEAT_MS = 10000;
static const uint32_t BEEP_F = 4000;     // KLJ-4020: 4 kHz nominali, massimo volume
static const uint32_t LOW_F = 2000;      // nota bassa per gli errori

// ── Sequenze di note / Note sequences ───────────────────────────────────────

struct Note { uint16_t f; uint16_t ms; };   // f = 0: pausa
static const int SEQ_MAX = 8;
static Note seq[SEQ_MAX];
static int seq_n = 0, seq_i = 0;
static uint32_t note_end = 0;
static portMUX_TYPE seq_mux = portMUX_INITIALIZER_UNLOCKED;

static const Note S_BOOT_OK[]  = {{3000, 80}, {0, 40}, {BEEP_F, 110}};
static const Note S_BOOT_ERR[] = {{LOW_F, 200}, {0, 150}, {LOW_F, 200}, {0, 150}, {LOW_F, 200}};
static const Note S_CLIENT[]   = {{BEEP_F, 40}};
static const Note S_OUT_ON[]   = {{BEEP_F, 70}};
static const Note S_FAULT[]    = {{BEEP_F, 120}, {0, 120}, {BEEP_F, 120}, {0, 120}, {BEEP_F, 120}};
static const Note S_CAL_OK[]   = {{3000, 80}, {0, 40}, {BEEP_F, 80}, {0, 40}, {5000, 140}};
static const Note S_CAL_ERR[]  = {{LOW_F, 500}};

// IT: Avvia una sequenza (sostituisce quella in corso). EN: Starts a sequence (replaces the current one).
static void play(const Note *s, int n) {
    portENTER_CRITICAL(&seq_mux);
    seq_n = min(n, SEQ_MAX);
    for (int k = 0; k < seq_n; k++) seq[k] = s[k];
    seq_i = -1;
    note_end = 0;
    portEXIT_CRITICAL(&seq_mux);
}
#define PLAY(s) play(s, sizeof(s) / sizeof(s[0]))

// IT: Avanza la sequenza: nota successiva allo scadere della precedente. EN: Advances the sequence: next note when the previous one expires.
static void seq_step(uint32_t now) {
    Note n;
    {
        portENTER_CRITICAL(&seq_mux);
        bool next = seq_n > 0 && (seq_i < 0 || (int32_t)(now - note_end) >= 0);
        if (next) seq_i++;
        bool done = next && seq_i >= seq_n;
        if (done) seq_n = 0;
        n = next && !done ? seq[seq_i] : Note{0, 0};
        if (next && !done) note_end = now + n.ms;
        portEXIT_CRITICAL(&seq_mux);
        if (!next) return;
        if (done) {
            buzzer_off();
            return;
        }
    }
    if (n.f) buzzer_tone(n.f);
    else buzzer_off();
}

// ── LED ─────────────────────────────────────────────────────────────────────

static volatile bool ota_active = false;
static Rgb manual = C_OFF;
static volatile uint32_t manual_until = 0;

// IT: Prova manuale del colore. EN: Manual colour test.
void status_led_override(uint8_t r, uint8_t g, uint8_t b, uint32_t ms) {
    manual = {r, g, b};
    manual_until = millis() + ms;
}

// IT: Segnala l'OTA. EN: Flags OTA.
void status_set_ota(bool active) {
    ota_active = active;
}

// IT: Colore lampeggiante: acceso per la prima metà del periodo. EN: Blinking colour: on for the first half of the period.
static Rgb blink(const Rgb &c, uint32_t now, uint32_t period_ms) {
    return (now % period_ms) < period_ms / 2 ? c : C_OFF;
}

// ── Task ────────────────────────────────────────────────────────────────────

// IT: Ogni 20 ms: legge lo stato, sceglie il colore, rileva gli eventi sonori, avanza le note.
// EN: Every 20 ms: reads the state, picks the colour, detects sound events, advances the notes.
static void status_task(void *) {
    bool was_out = false, was_fault = false, was_cal = false;
    int was_clients = 0;
    uint32_t fault_beep = 0;
    Rgb shown = {1, 1, 1};   // IT: forza la prima scrittura / EN: forces the first write

    for (;;) {
        uint32_t now = millis();
        bool out = dac_output_enabled() || sink_enabled();
        bool fault = dac_fault() || !sysinfo_dac_ok() || !sysinfo_adc_ok();
        bool cal = calib_running();
        int clients = WiFi.softAPgetStationNum();

        // Colore / Colour
        Rgb c = C_GREEN;
        if ((int32_t)(manual_until - now) > 0) c = manual;
        else if (ota_active) c = blink(C_MAGENTA, now, 250);
        else if (fault) c = blink(C_RED, now, 500);
        else if (cal) c = blink(C_BLUE, now, 1000);
        // IT: simulatore: viola, pulsazione lenta (non è un allarme: il rosso resta solo per i guasti reali)
        // EN: simulator: purple, slow pulse (not an alarm: red stays only for real failures)
        else if (procsim_running()) c = (now % 2000) < 1600 ? C_PURPLE : C_OFF;
        else if (out) c = C_AMBER;
        if (c.r != shown.r || c.g != shown.g || c.b != shown.b) {
            leds_set_rgb(c.r, c.g, c.b);
            shown = c;
        }

        // Eventi sonori (in ordine di importanza) / Sound events (by importance)
        if (dac_fault() && (!was_fault || now - fault_beep >= FAULT_REPEAT_MS)) {
            PLAY(S_FAULT);
            fault_beep = now;
        } else if (was_cal && !cal) {
            if (calib_last_ok()) PLAY(S_CAL_OK);
            else PLAY(S_CAL_ERR);
        } else if (out && !was_out && !cal) {
            PLAY(S_OUT_ON);
        } else if (clients > was_clients) {
            PLAY(S_CLIENT);
        }
        was_fault = dac_fault();
        was_cal = cal;
        was_out = out;
        was_clients = clients;

        seq_step(now);
        vTaskDelay(pdMS_TO_TICKS(TICK_MS));
    }
}

// IT: Suono di avvio. EN: Start-up sound.
void status_boot_sound(bool ok) {
    if (ok) PLAY(S_BOOT_OK);
    else PLAY(S_BOOT_ERR);
}

// IT: Avvia il task (core 1, priorità bassa). EN: Starts the task (core 1, low priority).
void status_start() {
    xTaskCreatePinnedToCore(status_task, "status", 3072, nullptr, 1, nullptr, 1);
}
