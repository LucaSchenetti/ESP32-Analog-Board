/*
  IT: LED RGB (PWM, attivo basso) e LED di test.
  EN: RGB LED (PWM, active low) and test LED.
*/
#include "leds.h"

#include <Arduino.h>
#include "pins.h"

// LED RGB XL-2012RGBC ad anodo comune (pin 3 = +3,3 V; pin 1/2/4 = catodi R/G/B):
// si accende con GPIO BASSO (XL-2012RGBC datasheet, schema interno pag. 9).
static const bool RGB_ACTIVE_HIGH = false;
static const bool TEST_ACTIVE_HIGH = true;

// Canali LEDC (API Arduino-ESP32 2.x)
static const uint8_t CH_R = 0, CH_G = 1, CH_B = 2;
static const uint32_t PWM_FREQ = 5000;
static const uint8_t PWM_BITS = 8;

// IT: Scrive un canale PWM tenendo conto della polarità.
// EN: Writes a PWM channel taking polarity into account.
static void write_ch(uint8_t ch, uint8_t v) {
    ledcWrite(ch, RGB_ACTIVE_HIGH ? v : 255 - v);
}

// IT: Configura i canali PWM e spegne i LED.
// EN: Sets up the PWM channels and turns the LEDs off.
void leds_init() {
    ledcSetup(CH_R, PWM_FREQ, PWM_BITS);
    ledcSetup(CH_G, PWM_FREQ, PWM_BITS);
    ledcSetup(CH_B, PWM_FREQ, PWM_BITS);
    ledcAttachPin(PIN_LED_R, CH_R);
    ledcAttachPin(PIN_LED_G, CH_G);
    ledcAttachPin(PIN_LED_B, CH_B);
    leds_set_rgb(0, 0, 0);

    pinMode(PIN_LED_TEST, OUTPUT);
    leds_set_test(false);
}

// IT: Imposta il colore RGB.
// EN: Sets the RGB colour.
void leds_set_rgb(uint8_t r, uint8_t g, uint8_t b) {
    write_ch(CH_R, r);
    write_ch(CH_G, g);
    write_ch(CH_B, b);
}

// IT: Accende/spegne il LED di test.
// EN: Turns the test LED on/off.
void leds_set_test(bool on) {
    digitalWrite(PIN_LED_TEST, on == TEST_ACTIVE_HIGH ? HIGH : LOW);
}

// IT: Sequenza di prova dei LED.
// EN: LED test sequence.
void leds_selftest() {
    const uint8_t seq[][3] = {{255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255}};
    for (auto &c : seq) {
        leds_set_rgb(c[0], c[1], c[2]);
        delay(500);
    }
    leds_set_rgb(0, 0, 0);
    leds_set_test(true);
    delay(500);
    leds_set_test(false);
}
