/*
  IT: Avvio del firmware: periferiche, test di avvio, misure, web server e OTA.
  EN: Firmware start-up: peripherals, boot tests, measurements, web server and OTA.
*/
#include <Arduino.h>

#include "adc.h"
#include "buzzer.h"
#include "calib.h"
#include "dac.h"
#include "leds.h"
#include "ota.h"
#include "pin.h"
#include "power.h"
#include "sink.h"
#include "status.h"
#include "sysinfo.h"
#include "web_server.h"

// IT: Inizializza tutto nell'ordine sicuro (sink spento per primo).
// EN: Initialises everything in a safe order (sink off first).
void setup() {
    // Prima di tutto: sink a 2 fili disabilitato (GPIO38 ALTO). Il livello viene scritto
    // prima di abilitare l'uscita, così il pin non passa mai da basso.
    sink_init();
    calib_load();
    pin_load();

    Serial.begin(115200);
    delay(500);
    Serial.println("[BOOT] ESP32-S3FN8 pronto");

    leds_init();
    Serial.println("[BOOT] Autotest LED: R, G, B, bianco, LED test");
    leds_selftest();
    leds_set_rgb(0, 40, 0);    // IT: verde = scheda alimentata (poi gestito da status.cpp) / EN: green = board powered (then handled by status.cpp)

    buzzer_init();

    power_init();
    PowerStatus p = power_read();
    Serial.printf("[BOOT] VUSB %.3f V (pin %lu mV, ATTEN%u)  24V=%d  5V=%d\n",
                  p.vusb_mv / 1000.0f, (unsigned long)p.pin_mv, p.atten, p.ext24, p.ext5);

    dac_init();
    String r;
    bool dac_ok = dac_selftest(r);
    Serial.printf("[BOOT] Test AD5412: %s\n%s\n", dac_ok ? "OK" : "FALLITO", r.c_str());

    adc_init();
    bool adc_ok = adc_selftest(r);
    Serial.printf("[BOOT] Test ADS1220: %s\n%s\n", adc_ok ? "OK" : "FALLITO", r.c_str());
    sysinfo_set_selftest(dac_ok, adc_ok);
    adc_measure_start();

    web_server_start();
    ota_start();

    // IT: LED verde fisso da qui in poi (stato automatico) e suono di avvio secondo i test
    // EN: steady green LED from here on (automatic state) and start-up sound according to the tests
    status_start();
    status_boot_sound(dac_ok && adc_ok);
}

// IT: Inattivo: il lavoro è nei task FreeRTOS.
// EN: Idle: the work runs in FreeRTOS tasks.
void loop() {
    // Tutto il lavoro è nei task FreeRTOS.
    vTaskDelay(pdMS_TO_TICKS(1000));
}
