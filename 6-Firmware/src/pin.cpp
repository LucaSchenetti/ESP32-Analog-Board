/*
  IT: PIN di servizio in NVS con blocco dopo 5 tentativi errati (vedi pin.h).
  EN: Service PIN in NVS with lock after 5 wrong attempts (see pin.h).
*/
#include "pin.h"

#include <Preferences.h>

static const char *NS = "sys";
static const char *KEY = "pin";
static const char *DEFAULT_PIN = "1234";
static const uint8_t MAX_FAILS = 5;
static const uint32_t LOCK_MS = 60000;

static String pin = DEFAULT_PIN;
static uint8_t fails = 0;
static uint32_t locked_until = 0;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

// IT: Legge il PIN dalla NVS. EN: Reads the PIN from NVS.
void pin_load() {
    Preferences p;
    p.begin(NS, true);
    pin = p.getString(KEY, DEFAULT_PIN);
    p.end();
}

// IT: Scrive il PIN in NVS. EN: Writes the PIN to NVS.
static void pin_save(const String &v) {
    Preferences p;
    p.begin(NS, false);
    p.putString(KEY, v);
    p.end();
}

// IT: Secondi di blocco rimanenti. EN: Remaining lock seconds.
uint32_t pin_locked_s() {
    int32_t left = (int32_t)(locked_until - millis());
    return left > 0 ? (left + 999) / 1000 : 0;
}

// IT: Controllo con conteggio dei tentativi errati. EN: Check counting wrong attempts.
PinResult pin_check(const String &v) {
    if (pin_locked_s()) return PIN_LOCKED;
    portENTER_CRITICAL(&mux);
    bool ok = v == pin;
    if (ok) {
        fails = 0;
    } else if (++fails >= MAX_FAILS) {
        fails = 0;
        locked_until = millis() + LOCK_MS;
    }
    portEXIT_CRITICAL(&mux);
    return ok ? PIN_OK : PIN_BAD;
}

// IT: true se il PIN è quello predefinito. EN: true if the PIN is the default one.
bool pin_is_default() {
    return pin == DEFAULT_PIN;
}

// IT: Cambio del PIN: nuovo PIN di sole cifre, 4–8. EN: PIN change: new PIN digits only, 4–8.
PinResult pin_change(const String &old_pin, const String &new_pin, bool &format_ok) {
    format_ok = new_pin.length() >= 4 && new_pin.length() <= 8;
    for (size_t i = 0; format_ok && i < new_pin.length(); i++) format_ok = isDigit(new_pin[i]);
    PinResult r = pin_check(old_pin);
    if (r != PIN_OK || !format_ok) return r;
    pin = new_pin;
    pin_save(pin);
    return PIN_OK;
}

// IT: Riscrive il PIN attuale in NVS. EN: Rewrites the current PIN to NVS.
void pin_restore() {
    pin_save(pin);
}
