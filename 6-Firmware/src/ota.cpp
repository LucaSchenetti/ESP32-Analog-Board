/*
  IT: Aggiornamento firmware e interfaccia via WiFi (ArduinoOTA).
  EN: Firmware and interface update over WiFi (ArduinoOTA).
*/
#include "ota.h"

#include <ArduinoOTA.h>
#include <WiFi.h>
#include "procsim.h"
#include "sink.h"
#include "status.h"

#ifndef OTA_PASSWORD
#error "OTA_PASSWORD not defined: see [ota] in platformio.ini"
#endif

// IT: Attende l'Access Point, avvia ArduinoOTA e lo gestisce.
// EN: Waits for the Access Point, starts ArduinoOTA and services it.
static void ota_task(void *) {
    // Attende che il task "web" abbia acceso l'Access Point.
    while (WiFi.softAPIP() == IPAddress(0, 0, 0, 0)) vTaskDelay(pdMS_TO_TICKS(200));

    ArduinoOTA.setHostname("iotester");
    ArduinoOTA.setPassword(OTA_PASSWORD);
    ArduinoOTA.onStart([]() {
        procsim_stop();
        sink_disable();   // GPIO38 ALTO + uscita AD5412 disabilitata
        status_set_ota(true);
        Serial.println("[OTA] Aggiornamento avviato: uscite spente");
    });
    ArduinoOTA.onEnd([]() { Serial.println("[OTA] Completato, riavvio"); });
    ArduinoOTA.onError([](ota_error_t e) {
        status_set_ota(false);
        Serial.printf("[OTA] Errore %u\n", (unsigned)e);
    });
    ArduinoOTA.begin();
    Serial.println("[OTA] Pronto su 192.168.4.1 (porta 3232)");

    for (;;) {
        ArduinoOTA.handle();
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

// IT: Avvia il task OTA sul core 0.
// EN: Starts the OTA task on core 0.
void ota_start() {
    // Core 0, come WiFi/AsyncTCP.
    xTaskCreatePinnedToCore(ota_task, "ota", 4096, nullptr, 1, nullptr, 0);
}
