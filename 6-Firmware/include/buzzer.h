#pragma once
/*
  Cicalino / Buzzer
  IT: Cicalino magnetico KLJ-4020 pilotato in PWM su GPIO37 tramite transistor (4 kHz nominali).
  EN: KLJ-4020 magnetic buzzer driven by PWM on GPIO37 through a transistor (4 kHz nominal).
*/

#include <stdint.h>

// IT: Configura il canale PWM e lascia il pin basso (transistor spento).
// EN: Sets up the PWM channel and leaves the pin low (transistor off).
void buzzer_init();

// IT: Suono continuo alla frequenza data (onda quadra 50%); 0 = spento.
// EN: Continuous tone at the given frequency (50% square wave); 0 = off.
void buzzer_tone(uint32_t freq_hz);

// IT: Spegne il cicalino (uscita bassa). EN: Switches the buzzer off (output low).
void buzzer_off();

// IT: Suono di durata fissa, non bloccante (spegnimento con un timer FreeRTOS).
// EN: Fixed-length tone, non-blocking (switched off by a FreeRTOS timer).
void buzzer_beep(uint32_t freq_hz, uint32_t ms);
