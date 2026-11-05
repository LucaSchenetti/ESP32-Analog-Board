#pragma once
/*
  Web server
  IT: Access Point "IO-Tester" e server HTTP asincrono: interfaccia da LittleFS (cartella data/),
      pagina di collaudo su /collaudo, API JSON su /api/…. Spegne le uscite se nessun client è collegato.
  EN: "IO-Tester" Access Point and asynchronous HTTP server: interface from LittleFS (data/ folder),
      test page at /collaudo, JSON API at /api/…. Switches outputs off when no client is connected.
*/

// IT: Avvia WiFi e web server in un task FreeRTOS dedicato (core 0).
// EN: Starts WiFi and the web server in a dedicated FreeRTOS task (core 0).
void web_server_start();
