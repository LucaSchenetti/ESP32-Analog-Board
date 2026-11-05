#pragma once
/*
  Mappa GPIO / GPIO map — ESP32-S3FN8
  IT: Tutti i pin usati dal firmware, con le note di progetto verificate sui datasheet.
  EN: All pins used by the firmware, with design notes checked against the datasheets.
*/

// Mappa GPIO ESP32-S3FN8 — calibratore I/O analogici (rev.0)
// GPIO 33–37 liberi: servono alla flash/PSRAM solo in modo Octal; FN8 è Quad-SPI
//   (ESP32-S3 datasheet v2.2, Tabella 2-14).
// GPIO 1–14, 17, 18 hanno un glitch basso di ~60 µs all'accensione; GPIO38 no
//   (ESP32-S3 datasheet v2.2, Tabella 2-2).
// Isolatori: 2× NSI8262W1-DSWR (4F+2R). Uscita di default ALTA quando il lato
//   d'ingresso non è alimentato (NSI826x datasheet 1.5, Tabella 7.1).

// ── Alimentazione ───────────────────────────────────────────────────────────
#define PIN_VUSB_SENSE      1    // ADC1_CH0: solo ingresso 5 V USB/powerbank (non il 5 V del buck dai 24 V),
                                 // partitore R1 150 kΩ / R2 68 kΩ. Serve a rilevare il powerbank scarico.
#define PIN_EXT24V_PRESENT  17   // presenza tensione esterna 24 V (ALTO = presente, verificato)
#define PIN_EXT5V_PRESENT   18   // presenza tensione esterna 5 V (ALTO = presente, verificato)

// ── AD5412 (uscita isolata, SPI) ────────────────────────────────────────────
#define PIN_DAC_FAULT       4    // FAULT, attivo basso (open-drain, pull-up).
                                 // Dominio COM_OUT spento → isolatore dà ALTO = "nessun guasto":
                                 // FAULT da solo non rileva il dominio spento, serve il readback SPI.
#define PIN_DAC_SDO         5    // SDO  → ESP32 (MISO)
#define PIN_DAC_SDIN        6    // SDIN ← ESP32 (MOSI)
#define PIN_DAC_SCLK        7
#define PIN_DAC_LATCH       8
#define PIN_SINK_EN         38   // 2_WIRE_T_EN_ISO: ALTO = sink DISABILITATO (Q1 conduce e tiene basso
                                 // il gate di Q2; R12 100 kΩ pull-up a DVCC), BASSO = sink abilitato.
                                 // Verificato sullo schema "2 WIRE CIRCUIT". Stato sicuro = ALTO.

// ── ADS1220 (ingresso isolato, SPI) ─────────────────────────────────────────
#define PIN_ADC_DRDY        10   // DRDY#
#define PIN_ADC_DOUT        11   // DOUT/DRDY# → ESP32 (MISO)
#define PIN_ADC_SCLK        12
#define PIN_ADC_CS          13
#define PIN_ADC_DIN         14   // DIN ← ESP32 (MOSI)

// ── Segnalazioni ────────────────────────────────────────────────────────────
// LED RGB XL-2012RGBC, anodo comune a 3,3 V → attivo BASSO
#define PIN_LED_R           33   // LED RGB rosso  (180 Ω)
#define PIN_LED_G           34   // LED RGB verde  (47 Ω)
#define PIN_LED_B           35   // LED RGB blu    (47 Ω)
#define PIN_LED_TEST        36   // LED di test blu
#define PIN_BUZZER          37   // cicalino magnetico KLJ-4020: 4000 Hz, 3,0 Vo-p, 12 Ω, max 100 mA
                                 // (KLJ-4020 datasheet, sez. B voci 1, 3, 4, 6)

// Non collegati: GPIO 2, 3, 9
