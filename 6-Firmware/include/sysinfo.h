#pragma once
/*
  Informazioni di sistema / System information
  IT: Esito dei test di avvio di AD5412 e ADS1220, temperatura del chip ESP32-S3, memoria e causa
      dell'ultimo riavvio, per il pannello "Stato sistema" dell'interfaccia.
  EN: Boot self-test results of AD5412 and ADS1220, ESP32-S3 chip temperature, memory and last
      reset reason, for the interface "System status" panel.
*/

// IT: Registra l'esito dei test di avvio (chiamata da setup()).
// EN: Records the boot self-test results (called from setup()).
void sysinfo_set_selftest(bool dac_ok, bool adc_ok);

// IT: true se il test di avvio dell'AD5412 è passato. EN: true if the AD5412 boot test passed.
bool sysinfo_dac_ok();

// IT: true se il test di avvio dell'ADS1220 è passato. EN: true if the ADS1220 boot test passed.
bool sysinfo_adc_ok();

// IT: Temperatura interna dell'ESP32-S3 [°C] (sensore integrato, indicativa).
// EN: ESP32-S3 internal temperature [°C] (built-in sensor, indicative).
float sysinfo_chip_temp();

// IT: Causa dell'ultimo riavvio come codice breve ("poweron", "sw", "panic", "wdt", "brownout", …).
// EN: Last reset reason as a short code ("poweron", "sw", "panic", "wdt", "brownout", …).
const char *sysinfo_reset_reason();
