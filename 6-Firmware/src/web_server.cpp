/*
  IT: Access Point, server HTTP, API JSON, pagina di collaudo e spegnimento automatico.
  EN: Access Point, HTTP server, JSON API, test page and automatic switch-off.
*/
#include "web_server.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <AsyncTCP.h>
#include <DNSServer.h>
#include <ESPAsyncWebServer.h>
#include <esp_wifi.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <nvs.h>
#include <nvs_flash.h>

#include "adc.h"
#include "buzzer.h"
#include "calib.h"
#include "dac.h"
#include "leds.h"
#include "pin.h"
#include "power.h"
#include "procsim.h"
#include "sink.h"
#include "status.h"
#include "sysinfo.h"
#include "version.h"

// ── Configurazione Access Point (prova) ─────────────────────────────────────
static const char *AP_SSID = "IO-Tester";
static const char *AP_PASS = "calibra123";   // min. 8 caratteri

static AsyncWebServer server(80);

// IT: Aggiornamento dalla pagina web: errore dell'upload in corso e riavvio programmato (0 = nessuno).
// EN: Update from the web page: error of the running upload and scheduled restart (0 = none).
static String upd_err;
static bool upd_active = false;
static volatile uint32_t restart_at = 0;

// IT: Captive portal: il DNS risponde a qualunque nome con l'IP dell'ESP32, così ogni indirizzo
//     http:// digitato (e il controllo "c'è internet?" del telefono) porta all'interfaccia.
// EN: Captive portal: DNS answers every name with the ESP32 IP, so any typed http:// address
//     (and the phone's "is there internet?" check) leads to the interface.
static DNSServer dns;
static const char *HOST_NAME = "iotester.local";

// IT: true se la richiesta è indirizzata all'ESP32 (IP o nome mDNS), false se è un altro sito.
// EN: true if the request targets the ESP32 (IP or mDNS name), false for any other site.
static bool own_host(AsyncWebServerRequest *req) {
    String h = req->host();
    return h.length() == 0 || h == WiFi.softAPIP().toString() || h.equalsIgnoreCase(HOST_NAME);
}

// IT: Reindirizza alla pagina principale dell'ESP32.
// EN: Redirects to the ESP32 home page.
static void to_portal(AsyncWebServerRequest *req) {
    req->redirect(String("http://") + WiFi.softAPIP().toString() + "/");
}

// ── Diagnostica antenna: risultati scansione reti vicine ────────────────────
// La scansione gira nel task "web" (è bloccante ~2 s); gli handler HTTP
// girano nel task AsyncTCP, quindi i risultati sono protetti da mutex.
struct ScanEntry {
    char ssid[33];
    int8_t rssi;
    uint8_t channel;
};

static const int SCAN_MAX = 20;
static ScanEntry scan_res[SCAN_MAX];
static int scan_count = 0;
static uint32_t scan_age_ms = 0;          // millis() dell'ultima scansione
static SemaphoreHandle_t scan_mutex;
static volatile bool scan_requested = false;
static volatile bool scan_running = false;

static const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IO Tester</title>
<style>
body{font-family:sans-serif;margin:16px;max-width:720px}
table{border-collapse:collapse}td,th{padding:4px 10px;text-align:left}
th{border-bottom:1px solid #999}.bar{display:inline-block;height:10px;background:#4a4}
.note{color:#555;font-size:0.9em}button{padding:6px 14px}
</style>
</head><body>
<h2>Calibratore analogico — test web server</h2>
<table>
<tr><td>Uptime</td><td id="up">-</td></tr>
<tr><td>Heap libero</td><td id="heap">-</td></tr>
<tr><td>Client AP</td><td id="cli">-</td></tr>
</table>

<h3>Alimentazione</h3>
<table>
<tr><td>VUSB</td><td id="vusb">-</td></tr>
<tr><td>Tensione su GPIO1</td><td id="vpin">-</td></tr>
<tr><td>GPIO17 (presenza 24 V)</td><td id="p24">-</td></tr>
<tr><td>GPIO18 (presenza 5 V)</td><td id="p5">-</td></tr>
</table>

<h3>Test LED</h3>
<p>RGB: R <input id="lr" type="range" min="0" max="255" value="0">
G <input id="lg" type="range" min="0" max="255" value="0">
B <input id="lb" type="range" min="0" max="255" value="0">
<button onclick="rgb()">Applica</button></p>
<p><button onclick="setRgb(255,0,0)">Rosso</button> <button onclick="setRgb(0,255,0)">Verde</button>
<button onclick="setRgb(0,0,255)">Blu</button> <button onclick="setRgb(255,255,255)">Bianco</button>
<button onclick="setRgb(0,0,0)">Spento</button></p>
<p>LED test blu: <button onclick="ledTest(1)">ON</button> <button onclick="ledTest(0)">OFF</button></p>

<h3>Test cicalino</h3>
<p>Frequenza <input id="bf" type="number" value="4000" min="100" max="10000" step="100" style="width:6em"> Hz,
durata <input id="bd" type="number" value="300" min="10" max="5000" step="10" style="width:5em"> ms
<button onclick="beep()">Beep</button> <button onclick="bcont()">Continuo</button> <button onclick="sweep()">Sweep 2–6 kHz</button>
<button onclick="bstop()">Stop</button> <span id="bsw"></span></p>

<h3>Calibrazione sink 2 fili (loopback)</h3>
<p class="note">Collegamento: <b>P2.5 L+ → P1.2 SIM+</b> e <b>P1.1 COM → P2.4 mA+</b>; tutti gli altri morsetti liberi.
Riferimento: ingresso corrente ADS1220 (shunt R34 0,05%). Durata ~20 s, non chiudere la pagina.</p>
<p><button onclick="calStart()">Avvia calibrazione</button> <button onclick="calClear()">Cancella calibrazione</button>
&nbsp;<b id="cstep">-</b> <span id="cmsg"></span></p>
<p>Coefficienti attivi: <span id="ccoef">-</span></p>
<table><thead><tr><th>Punto</th><th>Teorico</th><th>Misurato ADS1220</th><th>Scarto</th></tr></thead><tbody id="cpts"></tbody></table>
<table><thead><tr><th>Verifica</th><th>Misurato ADS1220</th><th>Errore</th><th>% su 16 mA</th></tr></thead><tbody id="cver"></tbody></table>

<h3>Ingressi ADS1220</h3>
<table>
<tr><th></th><th>Media (10 letture)</th><th>min … max</th><th>Codice</th></tr>
<tr><td>Tensione (P2.2 V+ / P2.1 V−)</td><td id="aiv">-</td><td id="aivr">-</td><td id="aivc">-</td></tr>
<tr><td>Corrente (P2.4 mA+ / P2.3 mA−)</td><td id="aii">-</td><td id="aiir">-</td><td id="aiic">-</td></tr>
</table>
<p class="note">Temperatura ADS1220: <span id="ait">-</span> — conversioni <span id="ain">-</span>, errori <span id="aie">-</span>.
Valori con componenti nominali, non calibrati.</p>

<h3>Uscite AD5412</h3>
<p><b>Tensione 0–10 V:</b>
<button onclick="oset('v',0)">0 V</button> <button onclick="oset('v',2.5)">2,5 V</button>
<button onclick="oset('v',5)">5 V</button> <button onclick="oset('v',7.5)">7,5 V</button>
<button onclick="oset('v',10)">10 V</button>
&nbsp; <input id="vv" type="number" value="1" min="0" max="10" step="0.001" style="width:6em"> V
<button onclick="oset('v',vv.value)">Imposta</button></p>
<p><b>Corrente 4–20 mA:</b>
<button onclick="oset('i',4)">4 mA</button> <button onclick="oset('i',8)">8 mA</button>
<button onclick="oset('i',12)">12 mA</button> <button onclick="oset('i',16)">16 mA</button>
<button onclick="oset('i',20)">20 mA</button>
&nbsp; <input id="iv" type="number" value="10" min="4" max="20" step="0.001" style="width:6em"> mA
<button onclick="oset('i',iv.value)">Imposta</button></p>
<p><b>Sink 2 fili:</b>
<button onclick="oset('s',4)">4 mA</button> <button onclick="oset('s',8)">8 mA</button>
<button onclick="oset('s',12)">12 mA</button> <button onclick="oset('s',16)">16 mA</button>
<button onclick="oset('s',20)">20 mA</button>
&nbsp; <input id="sv" type="number" value="10" min="0" max="23" step="0.001" style="width:6em"> mA
<button onclick="oset('s',sv.value)">Imposta</button></p>
<p><button onclick="voff()" style="background:#c33;color:#fff">Disabilita uscita</button>
&nbsp;<b id="vstate">-</b></p>
<table>
<tr><td>Codice scritto / riletto</td><td id="vcode">-</td></tr>
<tr><td>Controllo riletto</td><td id="vctrl">-</td></tr>
<tr><td>Valore teorico</td><td id="vth">-</td></tr>
<tr><td>Registro stato</td><td id="vsts">-</td></tr>
<tr><td>FAULT</td><td id="vflt">-</td></tr>
</table>
<p class="note">Tensione: carico ≥ 1 kΩ. Corrente: carico ≤ circa 1 kΩ a 20 mA (compliance AVDD − 2,5 V).
Sink 2 fili: loop alimentato dall'esterno su P1.2 SIM+ / P1.1 COM; con il sink attivo anche P1.4 V+ è in tensione.
La corrente del sink non è misurata dal calibratore (rev. A): loop aperto o invertito NON vengono segnalati.
L'uscita si azzera e si disabilita da sola se nessun dispositivo resta collegato al WiFi
dell'ESP32 (rilevamento entro ~10 s).</p>

<h3>Test AD5412 (SPI + readback)</h3>
<p><button onclick="dacTest()">Esegui test</button> <b id="dres"></b></p>
<table><thead><tr><th>Passo</th><th>Atteso</th><th>Letto</th><th></th></tr></thead>
<tbody id="dsteps"></tbody></table>
<p id="dinfo" class="note"></p>

<h3>Test ADS1220 (SPI + readback + temperatura)</h3>
<p><button onclick="adcTest()">Esegui test</button> <b id="ares"></b></p>
<table><thead><tr><th>Passo</th><th>Atteso</th><th>Letto</th><th></th></tr></thead>
<tbody id="asteps"></tbody></table>
<p id="ainfo" class="note"></p>

<h3>Diagnostica antenna</h3>
<table>
<tr><td>Potenza TX</td><td id="txp">-</td></tr>
<tr><td>Imposta TX</td><td>
<select id="txs">
<option>19.5</option><option>18.5</option><option>17</option><option>15</option>
<option>13</option><option>11</option><option>8.5</option><option>7</option>
<option>5</option><option>2</option>
</select> dBm <button onclick="setTx()">Applica</button></td></tr>
<tr><td>Canale AP</td><td id="ch">-</td></tr>
</table>

<h4>Client collegati (RSSI ricevuto dall'ESP32)</h4>
<table><thead><tr><th>MAC</th><th>RSSI</th><th>min / media / max (30 s)</th><th></th><th>Giudizio</th></tr></thead>
<tbody id="sta"></tbody></table>

<h4>Reti vicine</h4>
<button id="sb" onclick="scan()">Scansiona</button> <span id="sage"></span>
<table><thead><tr><th>SSID</th><th>Ch</th><th>RSSI</th><th></th></tr></thead>
<tbody id="nets"></tbody></table>

<p class="note">Prova: telefono a 1 m, in vista, fermo. Soglie indicative (empiriche, non da datasheet):
&ge; -50 dBm ottimo, -50…-67 buono, -67…-75 scarso, &lt; -75 pessimo.
Se a 1 m leggi -60 dBm o peggio, controlla antenna e rete di adattamento (C11 / L2 / C12).
Test potenza TX: leggi la rete IO-Tester dall'app del telefono a distanza fissa e cambia la potenza;
ogni -6 dB di TX l'RSSI letto dal telefono deve scendere di circa 6 dB.
La scansione cambia canale per ~2 s: il telefono collegato può perdere qualche pacchetto.</p>

<script>
const hist={};
// IT: giudizio testuale di un RSSI
// EN: text rating of an RSSI value
function q(r){return r>=-50?'ottimo':r>=-67?'buono':r>=-75?'scarso':'pessimo'}
// IT: barra grafica proporzionale all'RSSI
// EN: graphic bar proportional to RSSI
function bar(r){const w=Math.max(0,Math.min(100,(r+100)*2));return '<span class="bar" style="width:'+w+'px"></span>'}
// IT: aggiorna ogni secondo stato, alimentazione, ingressi, uscite, antenna
// EN: refreshes state, supply, inputs, outputs, antenna every second
async function upd(){
  try{
    const s=await (await fetch('/api/status')).json();
    up.textContent=s.uptime_s+' s';heap.textContent=s.heap+' B';cli.textContent=s.clients;
    cshow(await (await fetch('/api/cal/status')).json());
    const ai=await (await fetch('/api/adc')).json();
    // Sotto massa l'ADS1220 non misura (campo AVSS − 0,1 V, §6.3): una lettura negativa
    // significa quasi sempre polarità invertita, non un valore reale.
    aiv.textContent=ai.v.toFixed(4)+' V'+(ai.sat_v?'  ⚠ FUORI SCALA':(ai.v<-0.05?'  ⚠ NEGATIVA: polarità invertita? (valore non valido)':''));aivr.textContent=ai.v_min.toFixed(4)+' … '+ai.v_max.toFixed(4);
    aii.textContent=ai.i.toFixed(4)+' mA'+(ai.sat_i?'  ⚠ FUORI SCALA':(ai.i<-0.05?'  ⚠ NEGATIVA: polarità invertita? (valore non valido)':''));aiir.textContent=ai.i_min.toFixed(4)+' … '+ai.i_max.toFixed(4);
    aivc.textContent=ai.code_v;aiic.textContent=ai.code_i;
    ait.textContent=ai.temp==null?'-':ai.temp.toFixed(2)+' °C';ain.textContent=ai.n;aie.textContent=ai.err;
    vshow(await (await fetch('/api/dac/status')).json());
    const p=await (await fetch('/api/power')).json();
    vusb.textContent=(p.vusb_mv/1000).toFixed(3)+' V';
    vpin.textContent=p.pin_mv+' mV (ATTEN'+p.atten+')';
    p24.textContent=p.ext24?'ALTO':'BASSO';p5.textContent=p.ext5?'ALTO':'BASSO';
    const a=await (await fetch('/api/antenna')).json();
    txp.textContent=a.tx_dbm.toFixed(1)+' dBm';ch.textContent=a.channel;
    let h='';
    for(const t of a.stations){
      const k=hist[t.mac]=(hist[t.mac]||[]);k.push(t.rssi);if(k.length>30)k.shift();
      const mn=Math.min(...k),mx=Math.max(...k),av=k.reduce((x,y)=>x+y,0)/k.length;
      h+='<tr><td>'+t.mac+'</td><td>'+t.rssi+' dBm</td><td>'+mn+' / '+av.toFixed(1)+' / '+mx+'</td><td>'+bar(t.rssi)+'</td><td>'+q(av)+'</td></tr>';
    }
    sta.innerHTML=h||'<tr><td colspan="5">nessun client</td></tr>';
    let n='';
    for(const e of a.scan) n+='<tr><td>'+(e.ssid||'<i>nascosta</i>')+'</td><td>'+e.ch+'</td><td>'+e.rssi+' dBm</td><td>'+bar(e.rssi)+'</td></tr>';
    nets.innerHTML=n;
    sb.disabled=a.scanning;
    sage.textContent=a.scanning?'scansione in corso…':(a.scan_age_s>=0?'ultima: '+a.scan_age_s+' s fa ('+a.scan.length+' reti)':'');
  }catch(e){}
}
// IT: imposta i cursori RGB e applica
// EN: sets the RGB sliders and applies
function setRgb(r,g,b){lr.value=r;lg.value=g;lb.value=b;rgb();}
// IT: invia il colore RGB
// EN: sends the RGB colour
async function rgb(){await fetch('/api/led?r='+lr.value+'&g='+lg.value+'&b='+lb.value,{method:'POST'});}
// IT: accende/spegne il LED di test
// EN: turns the test LED on/off
async function ledTest(on){await fetch('/api/led?test='+on,{method:'POST'});}
// IT: suono di durata fissa
// EN: fixed-length tone
async function beep(){await fetch('/api/buzzer?f='+bf.value+'&ms='+bd.value,{method:'POST'});}
// IT: suono continuo
// EN: continuous tone
async function bcont(){await fetch('/api/buzzer?f='+bf.value,{method:'POST'});}
// IT: ferma suono e sweep
// EN: stops tone and sweep
async function bstop(){stopSweep=true;await fetch('/api/buzzer?f=0',{method:'POST'});}
let stopSweep=false;
// IT: sweep 2–6 kHz per trovare la risonanza
// EN: 2–6 kHz sweep to find the resonance
async function sweep(){
  stopSweep=false;
  for(let f=2000;f<=6000&&!stopSweep;f+=250){
    bsw.textContent=f+' Hz';
    await fetch('/api/buzzer?f='+f+'&ms=250',{method:'POST'});
    await new Promise(r=>setTimeout(r,300));
  }
  bsw.textContent='';
}
// IT: formatta un registro a 16 bit in esadecimale
// EN: formats a 16-bit register as hex
function hex4(x){return '0x'+x.toString(16).toUpperCase().padStart(4,'0');}
// IT: mostra lo stato dell'uscita AD5412 / sink
// EN: shows the AD5412 output / sink state
function vshow(d){
  const m=d.sink?'SINK 2 FILI ABILITATO — '+d.sink_ma.toFixed(3)+' mA teorici':['uscita disabilitata','TENSIONE 0–10 V ABILITATA','CORRENTE 4–20 mA ABILITATA'][d.mode];
  vstate.textContent=m;vstate.style.color=d.mode?'#c33':'';
  vcode.textContent=d.code+' / '+d.code_rb+(d.mode&&d.code!=d.code_rb?'  ✘':'');
  vctrl.textContent=hex4(d.ctrl_rb);
  vth.textContent=d.mode==1?d.theory.toFixed(4)+' V':d.mode==2?d.theory.toFixed(4)+' mA':'-';
  vsts.textContent=hex4(d.status_rb)+((d.status_rb&4)?'  IOUT fault':'')+((d.status_rb&1)?'  sovratemperatura':'');
  vflt.textContent=d.fault?'ATTIVO':'non attivo';
}
// IT: mostra lo stato della calibrazione
// EN: shows the calibration state
function cshow(c){
  cstep.textContent=c.running?'IN CORSO: '+c.step:(c.done?(c.ok?'✔ ':'✘ ')+c.step:'-');
  cmsg.textContent=c.msg||'';
  ccoef.textContent=c.cal.valid?('gain '+c.cal.gain.toFixed(6)+', offset '+(c.cal.offset*1000).toFixed(1)+' µA, data '+new Date(c.cal.date*1000).toLocaleString()):'nessuna (valori nominali)';
  let h='';for(const p of c.pts)h+='<tr><td>'+p.set+' mA</td><td>'+p.th.toFixed(4)+'</td><td>'+p.meas.toFixed(4)+'</td><td>'+((p.meas-p.th)*1000).toFixed(1)+' µA</td></tr>';
  cpts.innerHTML=h;h='';
  for(const v of c.ver){const e=v.meas-v.target;h+='<tr><td>'+v.target+' mA</td><td>'+v.meas.toFixed(4)+'</td><td>'+(e*1000).toFixed(1)+' µA</td><td>'+(e/16*100).toFixed(3)+'%</td></tr>';}
  cver.innerHTML=h;
}
// IT: avvia la calibrazione del sink
// EN: starts the sink calibration
async function calStart(){const p=prompt('PIN di servizio');if(!p)return;const r=await fetch('/api/cal/sink/start?t='+Math.floor(Date.now()/1000)+'&pin='+encodeURIComponent(p),{method:'POST'});if(r.status==403)alert('PIN errato o bloccato');}
// IT: cancella la calibrazione del sink
// EN: clears the sink calibration
async function calClear(){const p=prompt('PIN di servizio');if(!p)return;const r=await fetch('/api/cal/sink/clear?pin='+encodeURIComponent(p),{method:'POST'});if(r.status==403)alert('PIN errato o bloccato');}
// IT: imposta tensione, corrente o sink
// EN: sets voltage, current or sink
async function oset(m,x){vshow(await (await fetch('/api/dac/out?m='+m+'&x='+x,{method:'POST'})).json());}
// IT: spegne tutte le uscite
// EN: switches all outputs off
async function voff(){vshow(await (await fetch('/api/dac/off',{method:'POST'})).json());}
// IT: esegue il test SPI dell'AD5412
// EN: runs the AD5412 SPI test
async function dacTest(){
  dres.textContent='...';
  const r=await (await fetch('/api/dac/test',{method:'POST'})).json();
  let h='';
  for(const x of r.steps) h+='<tr><td>'+x.name+'</td><td>'+x.expect+'</td><td>'+x.read+'</td><td>'+(x.ok?'✔':'✘')+'</td></tr>';
  dsteps.innerHTML=h;
  dres.textContent=r.ok?'SUPERATO':'FALLITO';
  dinfo.textContent='FAULT: '+(r.fault?'ATTIVO (basso)':'non attivo (alto)')+(r.hint?' — '+r.hint:'');
}
// IT: esegue il test SPI dell'ADS1220
// EN: runs the ADS1220 SPI test
async function adcTest(){
  ares.textContent='...';
  const r=await (await fetch('/api/adc/test',{method:'POST'})).json();
  let h='';
  for(const x of r.steps) h+='<tr><td>'+x.name+'</td><td>'+x.expect+'</td><td>'+x.read+'</td><td>'+(x.ok?'✔':'✘')+'</td></tr>';
  asteps.innerHTML=h;
  ares.textContent=r.ok?'SUPERATO':'FALLITO';
  ainfo.textContent='DRDY: '+(r.drdy?'OK':'timeout')+(r.drdy?' — temperatura ADS1220 '+r.temp_c.toFixed(2)+' °C, conversione '+r.conv_ms+' ms':'')+(r.hint?' — '+r.hint:'');
}
// IT: imposta la potenza TX WiFi
// EN: sets the WiFi TX power
async function setTx(){await fetch('/api/txpower?dbm='+txs.value,{method:'POST'});upd();}
// IT: richiede la scansione delle reti
// EN: requests a network scan
async function scan(){await fetch('/api/scan',{method:'POST'});upd();}
setInterval(upd,1000);upd();
</script></body></html>
)rawliteral";

// IT: Invia lo stato dell'uscita AD5412 / sink in JSON.
// EN: Sends the AD5412 output / sink state as JSON.
static void send_dac_status(AsyncWebServerRequest *req, const DacOutStatus &d) {
    char json[224];
    snprintf(json, sizeof(json),
             "{\"mode\":%u,\"code\":%u,\"code_rb\":%u,\"ctrl_rb\":%u,\"status_rb\":%u,"
             "\"theory\":%.4f,\"fault\":%s,\"sink\":%s,\"sink_ma\":%.4f}",
             d.mode, d.code, d.code_rb, d.ctrl_rb, d.status_rb, d.theory, d.fault ? "true" : "false",
             sink_enabled() ? "true" : "false", sink_setpoint_ma());
    req->send(200, "application/json", json);
}

// IT: Segnale (RSSI) migliore fra i dispositivi collegati all'AP; 0 se nessuno.
// EN: Best signal (RSSI) among the devices connected to the AP; 0 if none.
static int best_client_rssi() {
    wifi_sta_list_t list;
    if (esp_wifi_ap_get_sta_list(&list) != ESP_OK || list.num == 0) return 0;
    int best = -127;
    for (int i = 0; i < list.num; i++) best = max(best, (int)list.sta[i].rssi);
    return best;
}

// IT: Formatta un float per JSON; "null" se non è un numero.
// EN: Formats a float for JSON; "null" when it is not a number.
static String jnum(float v, int decimals) {
    return isnan(v) ? String("null") : String(v, decimals);
}

// IT: Nomi dei canali di calibrazione in JSON e nei parametri ?ch= (stesso ordine di CalChannel).
// EN: Calibration channel names in JSON and in ?ch= parameters (same order as CalChannel).
static const char *CH_NAME[CAL_N] = {"sink", "vout", "iout", "vin", "iin"};

// IT: Invia lo stato completo dello strumento per l'interfaccia: alimentazione, uscita AD5412,
//     ingressi ADS1220, ESP32, WiFi e calibrazione di ogni canale.
// EN: Sends the complete instrument state for the interface: supply, AD5412 output,
//     ADS1220 inputs, ESP32, WiFi and calibration of every channel.
static void send_state(AsyncWebServerRequest *req) {
    PowerStatus p = power_read();
    DacOutStatus d = dac_out_status();
    AdcReadings a = adc_get();
    bool sink = sink_enabled();
    int8_t tx_q = 0;
    esp_wifi_get_max_tx_power(&tx_q);
    uint8_t ch = 0;
    wifi_second_chan_t ch2;
    esp_wifi_get_channel(&ch, &ch2);
    int rssi = best_client_rssi();
    auto b = [](bool v) { return v ? "true" : "false"; };

    String j;
    j.reserve(1200);
    j += "{\"fw\":\"" FW_VERSION "\",\"uptime\":";
    j += millis() / 1000;
    j += ",\"clients\":";
    j += WiFi.softAPgetStationNum();
    j += ",\"vusb\":" + String(p.vusb_mv / 1000.0f, 3);
    j += ",\"ext24\":"; j += b(p.ext24);
    j += ",\"ext5\":"; j += b(p.ext5);
    j += ",\"temp\":" + jnum(a.temp_c, 2);

    j += ",\"out\":{\"mode\":"; j += (unsigned)d.mode;
    j += ",\"sink\":"; j += b(sink);
    j += ",\"value\":" + String(sink ? sink_setpoint_ma() : d.expected, 4);
    j += ",\"nominal\":" + String(sink ? sink_nominal_ma() : d.theory, 4);
    j += ",\"code\":"; j += d.code;
    j += ",\"code_rb\":"; j += d.code_rb;
    j += ",\"ctrl\":"; j += d.ctrl_rb;
    j += ",\"calibrated\":"; j += b(calib_get(sink ? CAL_SINK : dac_mode_is_current(d.mode) ? CAL_IOUT : CAL_VOUT).valid);
    j += ",\"fault\":"; j += b(d.fault);
    j += ",\"status\":"; j += d.status_rb;
    j += ",\"selftest\":"; j += b(sysinfo_dac_ok());
    j += ",\"sim\":"; j += b(procsim_running());
    j += "}";

    j += ",\"in\":{\"v\":" + String(a.v, 5) + ",\"v_min\":" + String(a.v_min, 5) + ",\"v_max\":" + String(a.v_max, 5);
    j += ",\"i\":" + String(a.i_ma, 5) + ",\"i_min\":" + String(a.i_min, 5) + ",\"i_max\":" + String(a.i_max, 5);
    j += ",\"v_nom\":" + String(a.v_nom, 5) + ",\"i_nom\":" + String(a.i_nom, 5);
    j += ",\"code_v\":"; j += a.code_v;
    j += ",\"code_i\":"; j += a.code_i;
    j += ",\"sat_v\":"; j += b(a.sat_v);
    j += ",\"sat_i\":"; j += b(a.sat_i);
    j += ",\"n\":"; j += a.n;
    j += ",\"err\":"; j += a.errors;
    j += ",\"selftest\":"; j += b(sysinfo_adc_ok());
    j += "}";

    j += ",\"esp\":{\"temp\":" + jnum(sysinfo_chip_temp(), 1);
    j += ",\"heap\":"; j += ESP.getFreeHeap();
    j += ",\"heap_min\":"; j += ESP.getMinFreeHeap();
    j += ",\"cpu\":"; j += ESP.getCpuFreqMHz();
    j += ",\"reset\":\""; j += sysinfo_reset_reason(); j += "\"}";

    j += ",\"wifi\":{\"ssid\":\""; j += AP_SSID;
    j += "\",\"ch\":"; j += ch;
    j += ",\"tx\":" + String(tx_q * 0.25f, 2);
    j += ",\"rssi\":"; j += rssi ? String(rssi) : String("null");
    j += "}";

    j += ",\"cal\":{";
    for (int i = 0; i < CAL_N; i++) {
        CalCoeff c = calib_get((CalChannel)i);
        if (i) j += ",";
        j += "\""; j += CH_NAME[i]; j += "\":{\"valid\":"; j += b(c.valid);
        j += ",\"gain\":" + String(c.gain, 6);
        j += ",\"offset\":" + String(c.offset, 5);
        j += ",\"date\":"; j += c.date;
        j += ",\"temp\":" + jnum(c.temp_c, 1) + "}";
    }
    j += "}}";
    req->send(200, "application/json", j);
}

// IT: Registra tutte le pagine e le API.
// EN: Registers all pages and APIs.
// IT: Risposta per PIN errato o bloccato. EN: Reply for wrong or locked PIN.
static void send_pin_err(AsyncWebServerRequest *req, PinResult r) {
    String j = r == PIN_LOCKED ? "{\"ok\":false,\"err\":\"locked\",\"wait\":" + String(pin_locked_s()) + "}"
                               : String("{\"ok\":false,\"err\":\"pin\"}");
    req->send(403, "application/json", j);
}

// IT: Controlla il PIN di servizio (?pin=…); se errato risponde 403 e restituisce false.
// EN: Checks the service PIN (?pin=…); if wrong replies 403 and returns false.
static bool pin_guard(AsyncWebServerRequest *req) {
    PinResult r = pin_check(req->hasParam("pin") ? req->getParam("pin")->value() : String());
    if (r == PIN_OK) return true;
    send_pin_err(req, r);
    return false;
}

static void setup_routes() {
    // IT: Pagina principale da LittleFS (cartella data/); se manca, rimanda alla pagina di collaudo.
    // EN: Home page from LittleFS (data/ folder); if missing, redirects to the test page.
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!own_host(req)) return to_portal(req);   // IT: altro sito → pagina dell'ESP32 / EN: other site → ESP32 page
        if (LittleFS.exists("/index.html")) {
            req->send(LittleFS, "/index.html", "text/html");
        } else {
            req->redirect("/collaudo");
        }
    });

    // IT: Pagina di collaudo: quella dell'interfaccia (collaudo.html) se presente, altrimenti la versione interna al firmware.
    // EN: Test page: the interface one (collaudo.html) if present, otherwise the built-in version.
    server.on("/collaudo", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (LittleFS.exists("/collaudo.html")) req->send(LittleFS, "/collaudo.html", "text/html");
        else req->send(200, "text/html", INDEX_HTML);
    });

    server.on("/api/state", HTTP_GET, send_state);

    // IT: Uscite con calibrazione, per l'interfaccia: tensione 0–10 V e corrente 4–20 mA o 0–20 mA (?value=…[&range=0]).
    //     Spengono il sink se attivo; rifiutate durante una calibrazione. Rispondono con lo stato completo.
    // EN: Calibrated outputs for the interface: 0–10 V voltage and 4–20 mA or 0–20 mA current (?value=…[&range=0]).
    //     They switch the sink off if active; refused during a calibration. Reply with the full state.
    server.on("/api/out/v", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (calib_running() || !req->hasParam("value")) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        if (sink_enabled()) sink_disable();
        dac_set_voltage(constrain(req->getParam("value")->value().toFloat(), 0.0f, 10.0f));
        send_state(req);
    });
    server.on("/api/out/i", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (calib_running() || !req->hasParam("value")) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        if (sink_enabled()) sink_disable();
        // IT: range=0 → campo 0–20 mA (AD5412 Tab. 17), altrimenti 4–20 mA / EN: range=0 → 0–20 mA range, otherwise 4–20 mA
        bool zero20 = req->hasParam("range") && req->getParam("range")->value() == "0";
        dac_set_current(constrain(req->getParam("value")->value().toFloat(), zero20 ? 0.0f : 4.0f, 20.0f), zero20);
        send_state(req);
    });

    // IT: Simulazione trasmettitore a 2 fili: corrente del sink 0–22 mA con calibrazione (?value=…).
    //     Rifiutata durante una calibrazione. Risponde con lo stato completo.
    // EN: 2-wire transmitter simulation: sink current 0–22 mA with calibration (?value=…).
    //     Refused during a calibration. Replies with the full state.
    server.on("/api/out/sink", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (calib_running() || !req->hasParam("value")) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        sink_set_ma(constrain(req->getParam("value")->value().toFloat(), 0.0f, 22.0f));
        send_state(req);
    });

    // IT: Spegne tutte le uscite (sink compreso) e risponde con lo stato.
    // EN: Switches all outputs off (sink included) and replies with the state.
    server.on("/api/out/off", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        sink_disable();
        send_state(req);
    });

    // IT: Uptime, heap libero, client collegati.
    // EN: Uptime, free heap, connected clients.
    server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *req) {
        char json[128];
        snprintf(json, sizeof(json),
                 "{\"uptime_s\":%lu,\"heap\":%u,\"clients\":%u}",
                 (unsigned long)(millis() / 1000),
                 (unsigned)ESP.getFreeHeap(),
                 (unsigned)WiFi.softAPgetStationNum());
        req->send(200, "application/json", json);
    });

    // IT: Diagnostica antenna: potenza TX, canale, RSSI client, reti vicine.
    // EN: Antenna diagnostics: TX power, channel, client RSSI, nearby networks.
    server.on("/api/antenna", HTTP_GET, [](AsyncWebServerRequest *req) {
        String j;
        j.reserve(1536);

        int8_t tx_q = 0;                      // unità da 0,25 dBm
        esp_wifi_get_max_tx_power(&tx_q);
        uint8_t ch = 0;
        wifi_second_chan_t ch2;
        esp_wifi_get_channel(&ch, &ch2);

        j += "{\"tx_dbm\":";
        j += String(tx_q * 0.25f, 2);
        j += ",\"channel\":";
        j += ch;

        j += ",\"stations\":[";
        wifi_sta_list_t list;
        if (esp_wifi_ap_get_sta_list(&list) == ESP_OK) {
            for (int i = 0; i < list.num; i++) {
                const uint8_t *m = list.sta[i].mac;
                char mac[18];
                snprintf(mac, sizeof(mac), "%02X:%02X:%02X:%02X:%02X:%02X",
                         m[0], m[1], m[2], m[3], m[4], m[5]);
                if (i) j += ',';
                j += "{\"mac\":\"";
                j += mac;
                j += "\",\"rssi\":";
                j += list.sta[i].rssi;
                j += '}';
            }
        }
        j += ']';

        j += ",\"scanning\":";
        j += scan_running || scan_requested ? "true" : "false";

        j += ",\"scan\":[";
        xSemaphoreTake(scan_mutex, portMAX_DELAY);
        for (int i = 0; i < scan_count; i++) {
            if (i) j += ',';
            j += "{\"ssid\":\"";
            for (const char *c = scan_res[i].ssid; *c; c++) {   // escape minimo JSON
                if (*c == '"' || *c == '\\') j += '\\';
                if ((uint8_t)*c >= 0x20) j += *c;
            }
            j += "\",\"ch\":";
            j += scan_res[i].channel;
            j += ",\"rssi\":";
            j += scan_res[i].rssi;
            j += '}';
        }
        long age = scan_age_ms ? (long)((millis() - scan_age_ms) / 1000) : -1;
        xSemaphoreGive(scan_mutex);
        j += "],\"scan_age_s\":";
        j += age;
        j += '}';

        req->send(200, "application/json", j);
    });

    // LED: r,g,b (0…255) e/o test (0/1). I parametri assenti non vengono toccati.
    // IT: Imposta LED RGB e LED di test.
    // EN: Sets RGB and test LEDs.
    server.on("/api/led", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (req->hasParam("r") && req->hasParam("g") && req->hasParam("b")) {
            // IT: prova per 5 s, poi il LED torna allo stato automatico / EN: 5 s test, then back to automatic
            // IT: ms opzionale (1…60000) per la pagina di collaudo / EN: optional ms (1…60000) for the test page
            uint32_t ms = req->hasParam("ms") ? constrain(req->getParam("ms")->value().toInt(), 1, 60000) : 5000;
            status_led_override(constrain(req->getParam("r")->value().toInt(), 0, 255),
                         constrain(req->getParam("g")->value().toInt(), 0, 255),
                         constrain(req->getParam("b")->value().toInt(), 0, 255), ms);
        }
        if (req->hasParam("test")) {
            leds_set_test(req->getParam("test")->value().toInt() != 0);
        }
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // Cicalino: f in Hz (0 = stop), ms = durata (assente = continuo).
    // IT: Comanda il cicalino (frequenza, durata).
    // EN: Controls the buzzer (frequency, duration).
    server.on("/api/buzzer", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (!req->hasParam("f")) {
            req->send(400, "application/json", "{\"ok\":false}");
            return;
        }
        uint32_t f = constrain(req->getParam("f")->value().toInt(), 0, 10000);
        if (req->hasParam("ms")) {
            buzzer_beep(f, constrain(req->getParam("ms")->value().toInt(), 1, 5000));
        } else {
            buzzer_tone(f);
        }
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: VUSB e presenze 24 V / 5 V.
    // EN: VUSB and 24 V / 5 V presence.
    server.on("/api/power", HTTP_GET, [](AsyncWebServerRequest *req) {
        PowerStatus p = power_read();
        char json[128];
        snprintf(json, sizeof(json),
                 "{\"vusb_mv\":%lu,\"pin_mv\":%lu,\"atten\":%u,\"ext24\":%d,\"ext5\":%d}",
                 (unsigned long)p.vusb_mv, (unsigned long)p.pin_mv, p.atten, p.ext24, p.ext5);
        req->send(200, "application/json", json);
    });

    // m = v (0–10 V) | i (4–20 mA) | s (sink 2 fili), x = valore in V o mA; v e i sempre senza calibrazione
    // IT: Imposta uscita tensione, corrente o sink.
    // EN: Sets voltage output, current output or sink.
    server.on("/api/dac/out", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (!req->hasParam("m") || !req->hasParam("x")) {
            req->send(400, "application/json", "{\"ok\":false}");
            return;
        }
        if (calib_running()) {
            req->send(409, "application/json", "{\"ok\":false,\"err\":\"calibrazione in corso\"}");
            return;
        }
        String m = req->getParam("m")->value();
        float x = req->getParam("x")->value().toFloat();
        if (m == "s") {
            // IT: raw=1 → corrente nominale, senza calibrazione (pagina di collaudo)
            // EN: raw=1 → nominal current, without calibration (test page)
            bool raw = req->hasParam("raw") && req->getParam("raw")->value() == "1";
            send_dac_status(req, raw ? sink_set_ma_raw(x) : sink_set_ma(x));
            return;
        }
        if (sink_enabled()) sink_disable();   // uscita V o I: sink sempre spento
        if (m == "i0") {   // IT: corrente 0–20 mA nominale / EN: nominal 0–20 mA current
            send_dac_status(req, dac_set_current_raw(x, true));
            return;
        }
        bool is_i = m == "i";
        float frac = is_i ? (constrain(x, 4.0f, 20.0f) - 4.0f) / 16.0f
                          : constrain(x, 0.0f, 10.0f) / 10.0f;
        uint16_t code = (uint16_t)lroundf(frac * 4096.0f);
        send_dac_status(req, dac_out_set_code(is_i ? DAC_OUT_I_4_20 : DAC_OUT_V_0_10, code));
    });

    // IT: Spegne tutte le uscite (sink compreso).
    // EN: Switches all outputs off (sink included).
    server.on("/api/dac/off", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        sink_disable();   // GPIO38 ALTO + uscita AD5412 disabilitata
        send_dac_status(req, dac_out_status());
    });

    // IT: Stato dell'uscita.
    // EN: Output state.
    server.on("/api/dac/status", HTTP_GET, [](AsyncWebServerRequest *req) {
        send_dac_status(req, dac_out_status());
    });

    // IT: Test SPI dell'AD5412.
    // EN: AD5412 SPI test.
    server.on("/api/dac/test", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        String r;
        sink_disable();   // il test fa reset dell'AD5412
        dac_selftest(r);
        req->send(200, "application/json", r);
    });

    // IT: Avvia la calibrazione del sink (pagina di riserva; PIN obbligatorio).
    // EN: Starts the sink calibration (fallback page; PIN required).
    server.on("/api/cal/sink/start", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (!pin_guard(req)) return;
        uint32_t t = req->hasParam("t") ? (uint32_t)req->getParam("t")->value().toInt() : 0;
        bool ok = calib_sink_start(t);
        req->send(ok ? 200 : 409, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
    });

    // IT: Cancella la calibrazione del sink (pagina di riserva; PIN obbligatorio).
    // EN: Clears the sink calibration (fallback page; PIN required).
    server.on("/api/cal/sink/clear", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (!pin_guard(req)) return;
        if (calib_running()) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        calib_clear_sink();
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Canale di calibrazione dal parametro ?ch= (sink, vout, iout, vin, iin); CAL_N se assente o errato.
    // EN: Calibration channel from the ?ch= parameter (sink, vout, iout, vin, iin); CAL_N if missing or wrong.
    static auto cal_channel = [](AsyncWebServerRequest *req) -> CalChannel {
        if (!req->hasParam("ch")) return CAL_N;
        String n = req->getParam("ch")->value();
        for (int i = 0; i < CAL_N; i++)
            if (n == CH_NAME[i]) return (CalChannel)i;
        return CAL_N;
    };
    // IT: Parametro numerico float (NAN se assente). EN: Float numeric parameter (NAN if missing).
    static auto fparam = [](AsyncWebServerRequest *req, const char *name) -> float {
        return req->hasParam(name) ? req->getParam(name)->value().toFloat() : NAN;
    };

    // IT: Avvia la calibrazione automatica in loopback di un'uscita: ?ch=sink|vout|iout&t=epoch&pin=….
    // EN: Starts the automatic loopback calibration of an output: ?ch=sink|vout|iout&t=epoch&pin=….
    server.on("/api/cal/output", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (!pin_guard(req)) return;
        CalChannel ch = cal_channel(req);
        uint32_t t = req->hasParam("t") ? (uint32_t)req->getParam("t")->value().toInt() : 0;
        bool ok = (ch == CAL_SINK || ch == CAL_VOUT || ch == CAL_IOUT) && calib_output_start(ch, t);
        req->send(ok ? 200 : 409, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false}");
    });

    // IT: Calibrazione a due punti di un ingresso: ?ch=vin|iin&m1=&r1=&m2=&r2=&t=epoch
    //     (m = lettura nominale v_nom / i_nom, r = valore del multimetro di riferimento).
    // EN: Two-point calibration of an input: ?ch=vin|iin&m1=&r1=&m2=&r2=&t=epoch
    //     (m = nominal reading v_nom / i_nom, r = reference multimeter value).
    server.on("/api/cal/input", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (!pin_guard(req)) return;   // IT: PIN di servizio (?pin=…) / EN: service PIN (?pin=…)
        CalChannel ch = cal_channel(req);
        float m1 = fparam(req, "m1"), r1 = fparam(req, "r1"), m2 = fparam(req, "m2"), r2 = fparam(req, "r2");
        uint32_t t = req->hasParam("t") ? (uint32_t)req->getParam("t")->value().toInt() : 0;
        String err;
        bool ok = false;
        if (calib_running()) err = "calibrazione in corso";
        else if (isnan(m1) || isnan(r1) || isnan(m2) || isnan(r2)) err = "parametri mancanti";
        else ok = calib_input_two_point(ch, m1, r1, m2, r2, t, err);
        String j = "{\"ok\":";
        j += ok ? "true" : "false";
        j += ",\"err\":\"" + err + "\"}";
        req->send(ok ? 200 : 409, "application/json", j);
    });

    // IT: Cancella la calibrazione di un canale: ?ch=…&pin=… (rifiutata durante una calibrazione).
    // EN: Clears a channel calibration: ?ch=…&pin=… (refused during a calibration).
    server.on("/api/cal/clear", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (!pin_guard(req)) return;
        CalChannel ch = cal_channel(req);
        if (ch == CAL_N || calib_running()) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        calib_clear(ch);
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Informazioni per la pagina Aggiornamento: versione, data di compilazione, partizioni, LittleFS, NVS.
    // EN: Information for the Update page: version, build date, partitions, LittleFS, NVS.
    server.on("/api/update/info", HTTP_GET, [](AsyncWebServerRequest *req) {
        const esp_partition_t *run = esp_ota_get_running_partition();
        const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
        const esp_partition_t *fs = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, nullptr);
        nvs_stats_t ns = {};
        nvs_get_stats(nullptr, &ns);
        String j = "{\"fw\":\"" FW_VERSION "\",\"built\":\"" __DATE__ " " __TIME__ "\",\"idf\":\"";
        j += esp_get_idf_version();
        j += "\",\"running\":\"";
        j += run ? run->label : "?";
        j += "\",\"next\":\"";
        j += next ? next->label : "?";
        j += "\",\"app_max\":"; j += next ? next->size : 0;
        j += ",\"sketch\":"; j += ESP.getSketchSize();
        j += ",\"fs_size\":"; j += fs ? fs->size : 0;
        j += ",\"fs_used\":"; j += LittleFS.usedBytes();
        j += ",\"pin_default\":"; j += pin_is_default() ? "true" : "false";
        j += ",\"nvs_used\":"; j += ns.used_entries;
        j += ",\"nvs_total\":"; j += ns.total_entries;
        j += "}";
        req->send(200, "application/json", j);
    });

    // IT: Aggiornamento via pagina web: POST multipart su /api/update?target=fw|fs (firmware o LittleFS).
    //     Le uscite vengono spente, il LED lampeggia magenta; a buon fine riavvio dopo 1 s.
    // EN: Update from the web page: multipart POST to /api/update?target=fw|fs (firmware or LittleFS).
    //     Outputs are switched off, the LED blinks magenta; on success restart after 1 s.
    server.on("/api/update", HTTP_POST,
        [](AsyncWebServerRequest *req) {
            bool ok = upd_err.isEmpty() && !Update.hasError() && Update.isFinished();
            String j = "{\"ok\":";
            j += ok ? "true" : "false";
            j += ",\"err\":\"" + (ok ? String("") : (upd_err.isEmpty() ? String(Update.errorString()) : upd_err)) + "\"}";
            req->send(ok ? 200 : upd_err == "pin" || upd_err == "locked" ? 403 : 500, "application/json", j);
            upd_active = false;
            if (ok) {
                Serial.println("[UPD] Completato: riavvio fra 1 s");
                restart_at = millis() + 1000;
            } else if (upd_err != "pin" && upd_err != "locked") {
                status_set_ota(false);
                Serial.printf("[UPD] Fallito: %s\n", upd_err.c_str());
            }
        },
        [](AsyncWebServerRequest *req, const String &filename, size_t index, uint8_t *data, size_t len, bool final) {
            if (index == 0) {
                bool fs = req->hasParam("target") && req->getParam("target")->value() == "fs";
                upd_err = "";
                if (calib_running()) {
                    upd_err = "calibrazione in corso";
                    return;
                }
                // IT: PIN di servizio obbligatorio (?pin=…) / EN: service PIN required (?pin=…)
                PinResult pr = pin_check(req->hasParam("pin") ? req->getParam("pin")->value() : String());
                if (pr != PIN_OK) {
                    upd_err = pr == PIN_LOCKED ? "locked" : "pin";
                    return;
                }
                if (upd_active) Update.abort();
                upd_active = true;
                procsim_stop();
                sink_disable();          // GPIO38 ALTO + uscita AD5412 disabilitata
                status_set_ota(true);
                Serial.printf("[UPD] Inizio %s: %s\n", fs ? "LittleFS" : "firmware", filename.c_str());
                if (fs) LittleFS.end();
                if (!Update.begin(UPDATE_SIZE_UNKNOWN, fs ? U_SPIFFS : U_FLASH)) upd_err = Update.errorString();
            }
            if (!upd_err.isEmpty()) return;
            if (len && Update.write(data, len) != len) {
                upd_err = Update.errorString();
                Update.abort();
                return;
            }
            if (final && !Update.end(true)) upd_err = Update.errorString();
        });

    // IT: Verifica del PIN prima di un'operazione protetta (?pin=…). EN: PIN check before a protected operation (?pin=…).
    server.on("/api/pin/verify", HTTP_POST, [](AsyncWebServerRequest *req) {
        PinResult r = pin_check(req->hasParam("pin") ? req->getParam("pin")->value() : String());
        if (r != PIN_OK) return send_pin_err(req, r);
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Cambio del PIN di servizio (?old=…&new=…, nuovo PIN di 4–8 cifre).
    // EN: Service PIN change (?old=…&new=…, new PIN of 4–8 digits).
    server.on("/api/pin/change", HTTP_POST, [](AsyncWebServerRequest *req) {
        bool fmt_ok = false;
        PinResult r = pin_change(req->hasParam("old") ? req->getParam("old")->value() : String(),
                                 req->hasParam("new") ? req->getParam("new")->value() : String(), fmt_ok);
        if (r != PIN_OK) return send_pin_err(req, r);
        if (!fmt_ok) {
            req->send(400, "application/json", "{\"ok\":false,\"err\":\"format\"}");
            return;
        }
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Cancella tutta la NVS (calibrazioni comprese, il PIN viene riscritto) e riavvia: ?confirm=ELIMINA e ?pin= obbligatori.
    // EN: Erases the whole NVS (calibrations included, the PIN is rewritten) and restarts: ?confirm=ELIMINA and ?pin= required.
    server.on("/api/nvs/erase", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        if (!req->hasParam("confirm") || req->getParam("confirm")->value() != "ELIMINA" || calib_running()) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        PinResult pr = pin_check(req->hasParam("pin") ? req->getParam("pin")->value() : String());
        if (pr != PIN_OK) return send_pin_err(req, pr);
        sink_disable();
        esp_err_t e = nvs_flash_erase();
        // IT: la cancellazione de-inizializza la NVS: si riapre e si riscrive il PIN / EN: erasing de-initialises NVS: reopen and rewrite the PIN
        if (e == ESP_OK && nvs_flash_init() == ESP_OK) pin_restore();
        Serial.printf("[NVS] Cancellata (%s): riavvio fra 1 s\n", esp_err_to_name(e));
        req->send(e == ESP_OK ? 200 : 500, "application/json", e == ESP_OK ? "{\"ok\":true}" : "{\"ok\":false}");
        if (e == ESP_OK) restart_at = millis() + 1000;
    });

    // IT: Simulatore di processo: stato, ultimi campioni dello storico (?since=n) e configurazione.
    // EN: Process simulator: state, latest history samples (?since=n) and configuration.
    server.on("/api/sim/state", HTTP_GET, [](AsyncWebServerRequest *req) {
        SimConfig c;
        SimDist d;
        SimStatus st;
        procsim_get(c, d, st);
        uint32_t since = req->hasParam("since") ? (uint32_t)req->getParam("since")->value().toInt() : 0;
        static float h[60][4];
        uint32_t last = 0;
        int n = procsim_history(since, h, 60, last);
        String j;
        j.reserve(2600);
        j += "{\"running\":"; j += st.running ? "true" : "false";
        j += ",\"t\":" + String(st.t_s, 2);
        j += ",\"mv_sig\":" + String(st.mv_sig, 4) + ",\"mv\":" + String(st.mv_pct, 2);
        j += ",\"mv_bad\":"; j += st.mv_bad ? "true" : "false";
        j += ",\"valve\":" + String(st.valve, 2) + ",\"pv\":" + String(st.pv, 2) + ",\"pv_meas\":" + String(st.pv_meas, 2);
        j += ",\"out_sig\":" + String(st.out_sig, 4) + ",\"drift_acc\":" + String(st.drift_acc, 2);
        j += ",\"fault\":"; j += (unsigned)st.fault;
        j += ",\"dac_fault\":"; j += dac_fault() ? "true" : "false";   // IT: FAULT reale AD5412 (loop del sensore aperto) / EN: real AD5412 FAULT
        j += ",\"seq\":"; j += last;
        j += ",\"cfg\":{\"model\":"; j += (unsigned)c.model;
        j += ",\"gain\":" + String(c.gain, 3) + ",\"t1\":" + String(c.t1, 2) + ",\"t2\":" + String(c.t2, 2);
        j += ",\"dead\":" + String(c.dead, 2) + ",\"tfill\":" + String(c.tfill, 1) + ",\"outflow\":" + String(c.outflow, 1);
        j += ",\"pv0\":" + String(c.pv0, 1) + ",\"stroke\":" + String(c.stroke, 1) + ",\"db\":" + String(c.deadband, 2);
        j += ",\"eq\":"; j += c.eqpct ? "true" : "false";
        j += ",\"noise\":" + String(c.noise, 2);
        j += ",\"in\":"; j += (unsigned)c.in;
        j += ",\"out\":"; j += (unsigned)c.out;
        j += "},\"dist\":{\"load\":" + String(d.load, 1) + ",\"amp\":" + String(d.amp, 1) + ",\"period\":" + String(d.period, 1);
        j += ",\"drift\":" + String(d.drift, 2) + "},\"hist\":[";
        for (int k = 0; k < n; k++) {
            if (k) j += ",";
            j += "[" + String(h[k][0], 1) + "," + String(h[k][1], 2) + "," + String(h[k][2], 2) + "," + String(h[k][3], 2) + "]";
        }
        j += "]}";
        req->send(200, "application/json", j);
    });

    // IT: Avvio o aggiornamento della simulazione (?reset=1 riparte da capo). Parametri limitati a valori sensati.
    // EN: Simulation start or update (?reset=1 restarts from scratch). Parameters limited to sensible values.
    server.on("/api/sim/start", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (calib_running()) {
            req->send(409, "application/json", "{\"ok\":false}");
            return;
        }
        SimConfig c;
        SimDist d;
        SimStatus st;
        procsim_get(c, d, st);
        auto f = [req](const char *n, float def, float lo, float hi) -> float {
            return req->hasParam(n) ? constrain(req->getParam(n)->value().toFloat(), lo, hi) : def;
        };
        c.model = (SimModel)(int)f("model", c.model, 0, 2);
        c.gain = f("gain", c.gain, 0.01f, 100.0f);
        c.t1 = f("t1", c.t1, 0.1f, 3600.0f);
        c.t2 = f("t2", c.t2, 0.1f, 3600.0f);
        c.dead = f("dead", c.dead, 0.0f, 59.9f);
        c.tfill = f("tfill", c.tfill, 1.0f, 3600.0f);
        c.outflow = f("outflow", c.outflow, 0.0f, 100.0f);
        c.pv0 = f("pv0", c.pv0, -50.0f, 150.0f);
        c.stroke = f("stroke", c.stroke, 0.0f, 600.0f);
        c.deadband = f("db", c.deadband, 0.0f, 20.0f);
        c.eqpct = f("eq", c.eqpct, 0, 1) > 0.5f;
        c.noise = f("noise", c.noise, 0.0f, 20.0f);
        c.in = (SimIn)(int)f("in", c.in, 0, 2);
        c.out = (SimOut)(int)f("out", c.out, 0, 3);
        bool reset = req->hasParam("reset") && req->getParam("reset")->value() == "1";
        if (!procsim_running()) sink_disable();   // IT: si parte da uscite spente / EN: start from outputs off
        procsim_start(c, reset);
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Ferma la simulazione (uscite spente). EN: Stops the simulation (outputs off).
    server.on("/api/sim/stop", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Disturbi: ?load=&amp=&period=&drift= (in %, s, %/min). EN: Disturbances: ?load=&amp=&period=&drift=.
    server.on("/api/sim/dist", HTTP_POST, [](AsyncWebServerRequest *req) {
        SimConfig c;
        SimDist d;
        SimStatus st;
        procsim_get(c, d, st);
        auto f = [req](const char *n, float def, float lo, float hi) -> float {
            return req->hasParam(n) ? constrain(req->getParam(n)->value().toFloat(), lo, hi) : def;
        };
        d.load = f("load", d.load, -100.0f, 100.0f);
        d.amp = f("amp", d.amp, 0.0f, 50.0f);
        d.period = f("period", d.period, 1.0f, 3600.0f);
        d.drift = f("drift", d.drift, -10.0f, 10.0f);
        procsim_set_dist(d);
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Guasto del sensore simulato: ?f=0 nessuno, 1 filo rotto, 2 guasto basso, 3 guasto alto, 4 congelato.
    // EN: Simulated sensor failure: ?f=0 none, 1 broken wire, 2 low failure, 3 high failure, 4 frozen.
    server.on("/api/sim/fault", HTTP_POST, [](AsyncWebServerRequest *req) {
        int fv = req->hasParam("f") ? req->getParam("f")->value().toInt() : 0;
        procsim_set_fault((SimFault)constrain(fv, 0, 4));
        req->send(200, "application/json", "{\"ok\":true}");
    });

    // IT: Stato della calibrazione in corso.
    // EN: Running calibration state.
    server.on("/api/cal/status", HTTP_GET, [](AsyncWebServerRequest *req) {
        req->send(200, "application/json", calib_status_json());
    });

    // IT: Misure dell'ADS1220.
    // EN: ADS1220 readings.
    server.on("/api/adc", HTTP_GET, [](AsyncWebServerRequest *req) {
        AdcReadings a = adc_get();
        char json[320];
        char temp[16];
        if (isnan(a.temp_c)) strcpy(temp, "null");
        else snprintf(temp, sizeof(temp), "%.2f", a.temp_c);
        snprintf(json, sizeof(json),
                 "{\"v\":%.5f,\"v_min\":%.5f,\"v_max\":%.5f,\"i\":%.5f,\"i_min\":%.5f,\"i_max\":%.5f,"
                 "\"code_v\":%ld,\"code_i\":%ld,\"sat_v\":%s,\"sat_i\":%s,\"temp\":%s,\"n\":%lu,\"err\":%lu}",
                 a.v, a.v_min, a.v_max, a.i_ma, a.i_min, a.i_max, (long)a.code_v, (long)a.code_i,
                 a.sat_v ? "true" : "false", a.sat_i ? "true" : "false",
                 temp, (unsigned long)a.n, (unsigned long)a.errors);
        req->send(200, "application/json", json);
    });

    // IT: Test SPI dell'ADS1220.
    // EN: ADS1220 SPI test.
    server.on("/api/adc/test", HTTP_POST, [](AsyncWebServerRequest *req) {
        procsim_stop();   // IT: ferma il simulatore di processo / EN: stops the process simulator
        String r;
        adc_selftest(r);
        req->send(200, "application/json", r);
    });

    // IT: Richiede una scansione delle reti WiFi.
    // EN: Requests a WiFi network scan.
    server.on("/api/scan", HTTP_POST, [](AsyncWebServerRequest *req) {
        scan_requested = true;
        req->send(202, "application/json", "{\"ok\":true}");
    });

    // Potenza TX in dBm (2…20). Il valore effettivo, quantizzato dal driver,
    // si rilegge da /api/antenna.
    // IT: Imposta la potenza TX WiFi.
    // EN: Sets the WiFi TX power.
    server.on("/api/txpower", HTTP_POST, [](AsyncWebServerRequest *req) {
        if (!req->hasParam("dbm")) {
            req->send(400, "application/json", "{\"ok\":false}");
            return;
        }
        float dbm = req->getParam("dbm")->value().toFloat();
        int q = (int)lroundf(dbm * 4.0f);      // unità da 0,25 dBm
        q = constrain(q, 8, 80);
        esp_err_t err = esp_wifi_set_max_tx_power((int8_t)q);
        Serial.printf("[WEB] TX power %.2f dBm -> %s\n", q * 0.25f, esp_err_to_name(err));
        req->send(err == ESP_OK ? 200 : 500, "application/json",
                  err == ESP_OK ? "{\"ok\":true}" : "{\"ok\":false}");
    });

    // IT: File statici dell'interfaccia (css/, js/, img/); i .gz vengono serviti in automatico.
    //     "no-cache": il browser ricontrolla i file a ogni apertura, così un aggiornamento si vede subito.
    // EN: Static interface files (css/, js/, img/); .gz files are served automatically.
    //     "no-cache": the browser revalidates on every load, so updates show up at once.
    server.serveStatic("/", LittleFS, "/").setCacheControl("no-cache");

    // IT: Indirizzi di controllo connessione di Android, Apple, Windows e Firefox: rispondendo con un
    //     reindirizzamento il sistema apre da solo la pagina ("Accedi alla rete").
    // EN: Connectivity-check URLs of Android, Apple, Windows and Firefox: answering with a redirect
    //     makes the system open the page by itself ("Sign in to network").
    for (const char *url : {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
                            "/connecttest.txt", "/ncsi.txt", "/redirect", "/canonical.html", "/success.txt"}) {
        server.on(url, HTTP_ANY, to_portal);
    }

    // IT: Qualunque altro indirizzo: se è un altro sito porta all'ESP32, altrimenti 404.
    // EN: Any other address: another site leads to the ESP32, otherwise 404.
    server.onNotFound([](AsyncWebServerRequest *req) {
        if (!own_host(req)) return to_portal(req);
        req->send(404, "text/plain", "Not found");
    });
}

// IT: Avvia AP e server; poi scansione WiFi su richiesta, spegnimento automatico e log.
// EN: Starts AP and server; then on-demand WiFi scan, automatic switch-off and logging.
static void web_task(void *arg) {
    (void)arg;

    // AP+STA: l'interfaccia STA serve solo per la scansione, non si collega a nulla.
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(AP_SSID, AP_PASS);
    dns.setErrorReplyCode(DNSReplyCode::NoError);
    dns.start(53, "*", WiFi.softAPIP());
    // Un client sparito (fuori portata, WiFi spento) viene rimosso dopo 10 s invece dei
    // 300 s di default: serve allo spegnimento automatico dell'uscita.
    esp_wifi_set_inactive_time(WIFI_IF_AP, 10);
    Serial.printf("[WEB] AP \"%s\" attivo, IP %s\n",
                  AP_SSID, WiFi.softAPIP().toString().c_str());

    // IT: Monta l'interfaccia web; senza "pio run -t uploadfs" resta disponibile /collaudo.
    // EN: Mounts the web interface; without "pio run -t uploadfs" /collaudo is still available.
    if (!LittleFS.begin(false)) {
        Serial.println("[WEB] LittleFS non montato: caricare la cartella data/ (pio run -t uploadfs)");
    }

    setup_routes();
    server.begin();
    Serial.println("[WEB] Server HTTP avviato sulla porta 80");

    uint32_t last_log = 0;
    uint32_t no_client_since = 0;
    for (;;) {
        if (scan_requested) {
            scan_running = true;
            scan_requested = false;
            int n = WiFi.scanNetworks(false, true);   // bloccante, include reti nascoste
            xSemaphoreTake(scan_mutex, portMAX_DELAY);
            scan_count = 0;
            for (int i = 0; i < n && scan_count < SCAN_MAX; i++) {
                ScanEntry &e = scan_res[scan_count++];
                strlcpy(e.ssid, WiFi.SSID(i).c_str(), sizeof(e.ssid));
                e.rssi = (int8_t)WiFi.RSSI(i);
                e.channel = (uint8_t)WiFi.channel(i);
            }
            scan_age_ms = millis();
            xSemaphoreGive(scan_mutex);
            WiFi.scanDelete();
            scan_running = false;
            Serial.printf("[WEB] scansione: %d reti\n", n);
        }

        // IT: Riavvio programmato (dopo aggiornamento o cancellazione NVS), lasciando il tempo alla risposta HTTP
        // EN: Scheduled restart (after update or NVS erase), leaving time for the HTTP reply
        if (restart_at && (int32_t)(millis() - restart_at) >= 0) {
            Serial.flush();
            ESP.restart();
        }

        // Sicurezza: uscita abilitata e nessun dispositivo collegato per 2 s → azzera e disabilita.
        if ((dac_output_enabled() || sink_enabled()) && WiFi.softAPgetStationNum() == 0) {
            if (!no_client_since) no_client_since = millis();
            if (millis() - no_client_since >= 2000) {
                procsim_stop();   // IT: anche il simulatore di processo / EN: the process simulator too
                sink_disable();   // GPIO38 ALTO + uscita AD5412 disabilitata
                buzzer_beep(2000, 300);
                Serial.println("[WEB] Nessun client WiFi: uscita AD5412 azzerata e disabilitata");
                no_client_since = 0;
            }
        } else {
            no_client_since = 0;
        }

        if (millis() - last_log >= 5000) {
            last_log = millis();
            Serial.printf("[WEB] client=%u heap=%u\n",
                          (unsigned)WiFi.softAPgetStationNum(),
                          (unsigned)ESP.getFreeHeap());
        }
        dns.processNextRequest();
        vTaskDelay(pdMS_TO_TICKS(10));   // IT: 10 ms: risposte DNS rapide / EN: 10 ms: fast DNS answers
    }
}

// IT: Avvia il task web sul core 0.
// EN: Starts the web task on core 0.
void web_server_start() {
    scan_mutex = xSemaphoreCreateMutex();
    // Core 0: stesso core di WiFi/AsyncTCP; il core 1 resta libero per SPI/ADC/DAC.
    xTaskCreatePinnedToCore(web_task, "web", 4096, nullptr, 1, nullptr, 0);
}
