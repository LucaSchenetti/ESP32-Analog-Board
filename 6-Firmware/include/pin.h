#pragma once
/*
  PIN di servizio / Service PIN
  IT: Protegge le operazioni pericolose (aggiornamento firmware/interfaccia, cancellazione NVS). PIN di 4–8 cifre
      salvato in NVS (namespace "sys"), predefinito 1234; dopo 5 tentativi errati si blocca per 60 s.
  EN: Protects dangerous operations (firmware/interface update, NVS erase). 4–8 digit PIN stored in NVS
      (namespace "sys"), default 1234; after 5 wrong attempts it locks for 60 s.
*/

#include <Arduino.h>

// IT: Esito del controllo del PIN. EN: PIN check result.
enum PinResult : uint8_t { PIN_OK = 0, PIN_BAD, PIN_LOCKED };

// IT: Legge il PIN dalla NVS (all'avvio). EN: Reads the PIN from NVS (at boot).
void pin_load();

// IT: Controlla un PIN; conta i tentativi errati e applica il blocco. EN: Checks a PIN; counts wrong attempts and applies the lock.
PinResult pin_check(const String &pin);

// IT: Secondi di blocco rimanenti (0 = non bloccato). EN: Remaining lock seconds (0 = not locked).
uint32_t pin_locked_s();

// IT: true se il PIN è ancora quello predefinito. EN: true if the PIN is still the default one.
bool pin_is_default();

// IT: Cambia il PIN (vecchio corretto, nuovo di 4–8 cifre). EN: Changes the PIN (correct old one, new one of 4–8 digits).
PinResult pin_change(const String &old_pin, const String &new_pin, bool &format_ok);

// IT: Riscrive il PIN in NVS (dopo una cancellazione completa della NVS). EN: Rewrites the PIN to NVS (after a full NVS erase).
void pin_restore();
