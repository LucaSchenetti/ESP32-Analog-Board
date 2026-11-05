#pragma once
/*
  LED
  IT: LED RGB XL-2012RGBC (anodo comune, attivo basso, PWM) e LED di test blu.
  EN: XL-2012RGBC RGB LED (common anode, active low, PWM) and blue test LED.
*/

#include <stdint.h>

// IT: Configura i canali PWM e spegne tutti i LED. EN: Sets up the PWM channels and turns all LEDs off.
void leds_init();

// IT: Imposta il colore RGB, 0…255 per canale. EN: Sets the RGB colour, 0…255 per channel.
void leds_set_rgb(uint8_t r, uint8_t g, uint8_t b);

// IT: Accende o spegne il LED di test. EN: Turns the test LED on or off.
void leds_set_test(bool on);

// IT: Sequenza di prova all'avvio: rosso, verde, blu, bianco, LED di test (bloccante, ~2,5 s).
// EN: Start-up test sequence: red, green, blue, white, test LED (blocking, ~2.5 s).
void leds_selftest();
