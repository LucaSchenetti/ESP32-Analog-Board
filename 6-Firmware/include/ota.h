#pragma once
/*
  Aggiornamento via WiFi / Over-the-air update
  IT: ArduinoOTA protetto da password ([ota] in platformio.ini). Dal PC collegato all'AP
      "IO-Tester": pio run -e esp32-s3fn8-ota -t upload (firmware) o -t uploadfs (interfaccia).
  EN: Password-protected ArduinoOTA ([ota] in platformio.ini). From a PC connected to the
      "IO-Tester" AP: pio run -e esp32-s3fn8-ota -t upload (firmware) or -t uploadfs (interface).
*/

// IT: Avvia il task OTA; all'inizio di un aggiornamento spegne tutte le uscite.
// EN: Starts the OTA task; switches all outputs off when an update begins.
void ota_start();
