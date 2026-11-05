/*
  IT: Informazioni di sistema: test di avvio, temperatura ESP32-S3, causa del riavvio.
  EN: System information: boot tests, ESP32-S3 temperature, reset reason.
*/
#include "sysinfo.h"

#include <Arduino.h>
#include <esp_system.h>

static bool dac_ok = false;
static bool adc_ok = false;

// IT: Salva l'esito dei test di avvio.
// EN: Stores the boot test results.
void sysinfo_set_selftest(bool dac, bool adc) {
    dac_ok = dac;
    adc_ok = adc;
}

// IT: Esito del test AD5412.
// EN: AD5412 test result.
bool sysinfo_dac_ok() {
    return dac_ok;
}

// IT: Esito del test ADS1220.
// EN: ADS1220 test result.
bool sysinfo_adc_ok() {
    return adc_ok;
}

// IT: Legge il sensore di temperatura interno (Arduino-ESP32 temperatureRead()).
// EN: Reads the internal temperature sensor (Arduino-ESP32 temperatureRead()).
float sysinfo_chip_temp() {
    return temperatureRead();
}

// IT: Converte esp_reset_reason() in un codice breve per l'interfaccia.
// EN: Converts esp_reset_reason() into a short code for the interface.
const char *sysinfo_reset_reason() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON:  return "poweron";
        case ESP_RST_SW:       return "sw";
        case ESP_RST_PANIC:    return "panic";
        case ESP_RST_INT_WDT:
        case ESP_RST_TASK_WDT:
        case ESP_RST_WDT:      return "wdt";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_DEEPSLEEP:return "deepsleep";
        case ESP_RST_EXT:      return "ext";
        default:               return "other";
    }
}
