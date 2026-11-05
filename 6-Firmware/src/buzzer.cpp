/*
  IT: Cicalino KLJ-4020 in PWM (LEDC canale 4).
  EN: KLJ-4020 buzzer on PWM (LEDC channel 4).
*/
#include "buzzer.h"

#include <Arduino.h>
#include "pins.h"

// Cicalino magnetico KLJ-4020 pilotato da transistor (GPIO alto = bobina alimentata).
// Frequenza nominale 4000 Hz, onda quadra 50% (KLJ-4020 datasheet, sez. B voci 3, 6).
// A riposo il pin DEVE restare basso: in continua la bobina da 12 Ω scalda.

// Canale 4 → timer LEDC 2: non condivide il timer con i LED RGB (canali 0–2, timer 0–1).
static const uint8_t CH_BUZ = 4;
static TimerHandle_t off_timer;

// IT: Callback del timer: spegne il cicalino.
// EN: Timer callback: switches the buzzer off.
static void off_cb(TimerHandle_t) { buzzer_off(); }

// IT: Configura PWM e timer di spegnimento; uscita bassa.
// EN: Sets up PWM and the switch-off timer; output low.
void buzzer_init() {
    ledcSetup(CH_BUZ, 4000, 8);
    ledcAttachPin(PIN_BUZZER, CH_BUZ);
    buzzer_off();
    off_timer = xTimerCreate("buz", 1, pdFALSE, nullptr, off_cb);
}

// IT: Suono continuo alla frequenza data; 0 = spento.
// EN: Continuous tone at the given frequency; 0 = off.
void buzzer_tone(uint32_t freq_hz) {
    if (freq_hz == 0) {
        buzzer_off();
        return;
    }
    ledcWriteTone(CH_BUZ, freq_hz);
}

// IT: Spegne il cicalino (duty 0, transistor spento).
// EN: Switches the buzzer off (duty 0, transistor off).
void buzzer_off() {
    ledcWrite(CH_BUZ, 0);    // uscita bassa: transistor spento
}

// IT: Suono di durata fissa, non bloccante.
// EN: Fixed-length tone, non-blocking.
void buzzer_beep(uint32_t freq_hz, uint32_t ms) {
    buzzer_tone(freq_hz);
    xTimerChangePeriod(off_timer, pdMS_TO_TICKS(ms ? ms : 1), 0);
}
