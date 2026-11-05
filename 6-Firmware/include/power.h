#pragma once
/*
  Alimentazione / Power supply
  IT: Misura della tensione USB/powerbank su GPIO1 (partitore 150 k / 68 k, tarato) e presenza
      delle alimentazioni esterne 24 V (GPIO17) e 5 V (GPIO18).
  EN: USB/power-bank voltage measurement on GPIO1 (150 k / 68 k divider, trimmed) and presence
      of the external 24 V (GPIO17) and 5 V (GPIO18) supplies.
*/

#include <stdint.h>

// IT: Stato dell'alimentazione. EN: Power supply state.
struct PowerStatus {
    uint32_t pin_mv;      // IT: tensione su GPIO1 / EN: voltage on GPIO1
    uint32_t vusb_mv;     // IT: tensione USB ricostruita / EN: reconstructed USB voltage
    uint8_t atten;        // IT: attenuazione ADC usata (2 o 3) / EN: ADC attenuation used
    bool ext24;           // IT: 24 V presenti / EN: 24 V present
    bool ext5;            // IT: 5 V presenti / EN: 5 V present
};

// IT: Configura gli ingressi di presenza. EN: Configures the presence inputs.
void power_init();

// IT: Legge tensione USB (media di 32 campioni, portata automatica) e ingressi di presenza.
// EN: Reads USB voltage (32-sample average, automatic range) and presence inputs.
PowerStatus power_read();
