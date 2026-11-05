/*
  IT: Access Point ESP8266 di riferimento per il confronto dell'antenna del calibratore.
  EN: ESP8266 reference Access Point used to compare the calibrator antenna.
*/
// Access Point di riferimento "Ref8266" per confrontare l'antenna del calibratore.
// Stessa potenza (19,5 dBm) e stesso canale (1) dell'AP "IO-Tester" dell'ESP32-S3.
// Ogni 10 s scansiona e stampa l'RSSI con cui riceve "IO-Tester".
#include <Arduino.h>
#include <ESP8266WiFi.h>

static const char *AP_SSID = "Ref8266";
static const char *AP_PASS = "calibra123";
static const char *TARGET  = "IO-Tester";

// IT: Avvia l'AP di riferimento "Ref8266" a 19,5 dBm sul canale 1.
// EN: Starts the "Ref8266" reference AP at 19.5 dBm on channel 1.
void setup() {
    Serial.begin(115200);
    delay(200);

    WiFi.mode(WIFI_AP_STA);
    WiFi.setOutputPower(19.5f);
    WiFi.softAP(AP_SSID, AP_PASS, 1);
    Serial.printf("\n[REF] AP \"%s\" canale 1, TX 19,5 dBm\n", AP_SSID);
}

// IT: Ogni 10 s scansiona e stampa l'RSSI della rete "IO-Tester".
// EN: Every 10 s scans and prints the RSSI of the "IO-Tester" network.
void loop() {
    int n = WiFi.scanNetworks();
    bool found = false;
    for (int i = 0; i < n; i++) {
        if (WiFi.SSID(i) == TARGET) {
            Serial.printf("[REF] %s  RSSI %d dBm  ch %d\n",
                          TARGET, WiFi.RSSI(i), WiFi.channel(i));
            found = true;
        }
    }
    if (!found) Serial.printf("[REF] %s non trovato (%d reti)\n", TARGET, n);
    WiFi.scanDelete();
    delay(10000);
}
