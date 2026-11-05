#pragma once
/*
  Stato dello strumento: LED RGB e cicalino / Instrument state: RGB LED and buzzer
  IT: Task che sceglie il colore del LED secondo lo stato (priorità dall'alto):
        prova manuale (5 s)            → colore richiesto
        aggiornamento OTA              → magenta lampeggiante veloce
        FAULT AD5412 o test fallito    → rosso lampeggiante
        calibrazione in corso          → blu lampeggiante
        simulatore di processo attivo  → viola con pulsazione lenta
        uscita o sink attivi           → arancio fisso (morsetti in tensione)
        normale (scheda alimentata)    → verde fisso
      e suona il cicalino solo agli eventi: avvio, dispositivo collegato, uscita attivata,
      FAULT (ripetuto ogni 10 s finché resta), fine calibrazione.
  EN: Task that picks the LED colour from the state (priority from the top):
        manual test (5 s)              → requested colour
        OTA update                     → fast blinking magenta
        AD5412 FAULT or failed test    → blinking red
        calibration running            → blinking blue
        process simulator running      → purple with slow pulse
        output or sink active          → steady amber (terminals live)
        normal (board powered)         → steady green
      and sounds the buzzer only on events: start-up, device connected, output enabled,
      FAULT (repeated every 10 s while it lasts), end of calibration.
*/

#include <stdint.h>

// IT: Avvia il task di stato (core 1, ogni 20 ms). EN: Starts the state task (core 1, every 20 ms).
void status_start();

// IT: Suono di avvio: ok = due note salenti, altrimenti tre note basse. EN: Start-up sound: ok = two rising notes, otherwise three low notes.
void status_boot_sound(bool ok);

// IT: Mostra un colore per ms millisecondi (prova dalla pagina Diagnostica), poi torna automatico.
// EN: Shows a colour for ms milliseconds (test from the Diagnostics page), then back to automatic.
void status_led_override(uint8_t r, uint8_t g, uint8_t b, uint32_t ms);

// IT: Segnala un aggiornamento OTA in corso. EN: Flags an OTA update in progress.
void status_set_ota(bool active);
