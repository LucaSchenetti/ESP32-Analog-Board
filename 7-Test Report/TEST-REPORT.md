# Rapporto di collaudo — IO Tester (calibratore I/O analogici), PCB rev. B

| | |
|---|---|
| Documento | Rapporto di collaudo, **edizione 2** (2026-10-10). L'edizione 1 (2026-10-01) conteneva solo i risultati riassunti |
| Esemplare | PCB rev. B, 4 strati 90 × 80,5 mm, prodotto e assemblato da JLCPCB (settembre 2026), ESP32-S3FN8 |
| Periodo delle prove | 2026-09-29 → 2026-10-01 |
| Operatore | Luca Schenetti |
| Firmware | Pagina di collaudo `/collaudo` dell'interfaccia web |
| Strumenti | Multimetro portatile a 2 decimali (incertezza in mA ≈ 0,3%), alimentatore da banco 24 V con limite di corrente, misuratore USB di corrente, resistenze di carico 1 kΩ, 100 kΩ, 503 Ω (misurata), telefono Samsung Galaxy A54 con app WiFi Analyzer, ESP8266 di riferimento |
| Non disponibili | Strumento di riferimento ≥ 5½ cifre, misuratore d'isolamento 500 V, oscilloscopio (non usato), PLC Siemens |
| Datasheet citati | `5-Spec/` del repository (AD5412.pdf, ads1220.pdf, B0524S-2WR3.pdf, PTC.pdf, KLJ-4020.pdf, NSI8262W1-DSWR.pdf, esp32-s3_datasheet_en.pdf) |

Convenzioni: "impostato" = valore richiesto dalla pagina; "teorico" = valore che corrisponde al codice DAC effettivamente scritto
(AD5412 a 12 bit: a 10 V il codice massimo 4095 dà 9,9976 V, a 20 mA dà 19,9961 mA); i valori misurati sono riportati
esattamente come letti, con le cifre dello strumento.

## Morsetti (serigrafia PCB)

| P1 OUTPUT | | P2 INPUT | |
|---|---|---|---|
| P1.1 | COM | P2.1 | V− |
| P1.2 | SIM+ | P2.2 | V+ |
| P1.3 | mA+ | P2.3 | mA− |
| P1.4 | V+ | P2.4 | mA+ |
| | | P2.5 | L+ |

## Riepilogo

| Fase | Contenuto | Esito |
|---|---|---|
| 0–2 | Ispezione visiva, misure a freddo, prima accensione | Eseguite prima di questo rapporto (nessun dato registrato) |
| 3 | Ingresso 24 V e polarità invertita | ✔ |
| 4 | Periferiche, SPI, isolatori, WiFi | ✔ |
| 5 | Uscite AD5412 (0–10 V, 4–20 mA) | ✔ con limite noto (F1 fuori anello) |
| 6 | Ingressi ADS1220 in loopback | ✔ |
| 7 | Sink 2 fili, interlock, calibrazione | ✔ dopo calibrazione (±0,21%) |
| 8 | Protezioni | ✔ (8.6 non eseguita) |
| 9 | Isolamento 500 V | **Non eseguita** (manca lo strumento) |
| 10 | Consumi | ✔ (corrente d'avvio non misurata) |
| 10 | Verifica metrologica e prova su PLC | **Non eseguita** (mancano strumento e PLC) |
| 11 | Prove funzionali successive (compliance, app Android) | ✔ |

---

## Fase 3 — Ingresso 24 V di campo

Ingresso P3 → F4 → D16 → Q3 (P-MOSFET contro l'inversione) → R45 4,7 Ω → D17 → buck AP63301 → 5 V.

| Prova | Condizioni | Misurato | Esito |
|---|---|---|---|
| 3.1 Polarità invertita | 24 V invertiti su P3, limite 100 mA, USB scollegata | **0 mA**, nessun componente caldo | ✔ Q3 blocca |
| 3.2 Polarità corretta | 24 V su P3 | Avvio regolare, assorbimento normale, GPIO17 (presenza 24 V) = ALTO | ✔ |

Sigle di D16, D17, F4 e Q3: **non ancora note** (servono per verificare i margini: Q3 almeno 30 V V_DS).

## Fase 4 — Periferiche, SPI, isolatori, WiFi

### 4.1 Periferiche del dominio logico

| Prova | Misurato | Esito |
|---|---|---|
| LED RGB XL-2012RGBC (anodo comune su 3,3 V, catodi GPIO33/34/35) | Sequenza R, G, B, bianco corretta (pilotaggio attivo basso) | ✔ |
| LED di test blu (GPIO36) | Acceso/spento | ✔ |
| Cicalino KLJ-4020 (GPIO37 PWM via transistor) | Suono a 4 kHz, sweep 2–6 kHz | ✔ |
| Presenza 5 V (GPIO18) con alimentazione USB | ALTO | ✔ |
| Presenza 24 V (GPIO17) con 24 V su P3 | ALTO | ✔ |
| Misura VUSB (GPIO1, partitore 150 kΩ / 68 kΩ) | Pagina **4,902 V**, multimetro **5,000 V** → fattore di correzione **1,0200** inserito nel firmware | ✔ |

### 4.2 AD5412 (FSPI 1 MHz, mode 0, attraverso NSI8262W1)

Prima esecuzione del test di scrittura e rilettura:

| Passo | Atteso | Letto | Esito |
|---|---|---|---|
| Status dopo reset | 0x0000 | 0x0000 | ✔ |
| Control dopo reset | 0x0000 | 0x0000 | ✔ |
| Control = 0x0AA1 | 0x0AA1 | 0x0AA1 | ✔ |
| Control = 0x0552 | 0x0552 | 0x0552 | ✔ |
| Data = 0xABC | 0xABC0 | 0x8018 | ✘ |
| Data = 0x543 | 0x5430 | 0x8020 | ✘ |
| Control dopo reset finale | 0x0000 | 0x0000 | ✔ |

Causa: il valore di prova 0x0552 abilitava lo slew rate (SREN, AD5412.pdf Tab. 16), quindi il registro dati veniva riletto
durante la rampa. Correzione nel firmware: control = 0x0001 (slew disabilitato) prima dei passi sui dati. Seconda esecuzione: **tutti i passi ✔**.
La comunicazione attraverso l'isolatore è quindi corretta.

### 4.3 ADS1220 (HSPI 1 MHz, mode 1, DRDY su GPIO10)

| Prova | Misurato | Esito |
|---|---|---|
| Scrittura/rilettura dei 4 registri | Coincidono | ✔ |
| Conversione del sensore di temperatura interno | **34,94 °C**, conversione **51 ms** a 20 SPS | ✔ |

### 4.4 WiFi e antenna PCB (rete di adattamento C11 1,2 pF → L2 2,7 nH → C12 1,5 pF)

RSSI letto dal telefono con WiFi Analyzer, salvo dove indicato.

| Prova | Misurato |
|---|---|
| Telefono a 2 m in linea d'aria, letto dall'ESP32 | −59 dBm (min/media/max −59 / −59,0 / −59) |
| Orientamento dell'antenna verso il telefono / dalla parte opposta | −55 dBm / −66 dBm |
| Modem di casa, stanza diversa: letto dal telefono / letto dall'ESP32 | −73 dBm / −73 dBm |
| Potenza TX 19,5 dBm / 13 dBm / 7 dBm (telefono fermo) | −55…−60 dBm / −68 dBm / −70 dBm |
| A 2 m, antenna orientata verso il telefono | −52…−55 dBm |
| ESP8266 di riferimento (stessa potenza 19,5 dBm, canale 1, stesso punto) | −55 dBm |
| Telefono letto dall'ESP32 durante il cambio di potenza TX | −48 dBm costante (corretto: la potenza TX non cambia la ricezione) |

Esito ✔: l'antenna PCB rende come l'ESP8266 di riferimento (scarto 0…−3 dB) e come il telefono verso il modem; il comando
di potenza TX funziona (19,5 → 7 dBm = −12,5 dB, letti circa −12,5 dB). Il valore assoluto a 2 m dipende da telefono e ambiente.

## Fase 5 — Uscite AD5412

AVDD misurato **23,5 V** (B0524S-2WR3, non regolato). AVSS −4 V da LM27761.

### 5.1 Uscita tensione 0–10 V (P1.4 V+ / P1.1 COM), misura con il multimetro sul morsetto

| Impostato | Teorico | A vuoto | Con 100 kΩ | Con 1 kΩ | Scarto con 1 kΩ |
|---|---|---|---|---|---|
| 2,5 V | 2,5000 V | 2,49 V | 2,49 V | 2,48 V | −20 mV (−0,8%) |
| 5 V | 5,0000 V | 4,99 V | 4,99 V | 4,96 V | −40 mV (−0,8%) |
| 7,5 V | 7,5000 V | 7,49 V | 7,49 V | 7,45 V | −50 mV (−0,7%) |
| 10 V | 9,9976 V | 9,99 V | 9,99 V | 9,92 V | −78 mV (−0,8%) |

- **A vuoto e con 100 kΩ:** scarti entro ±10 mV, pari alla risoluzione del multimetro; specifica TUE ±0,1% FSR a 25 °C (AD5412.pdf Tab. 2). ✔
- **Con 1 kΩ:** scarto proporzionale alla corrente: 78 mV / 9,92 mA ≈ **7,9 Ω**. È la resistenza del PPTC F1, che si trova **fuori** dall'anello +VSENSE
  (R_F1 1,6–15 Ω, PTC.pdf). Limite noto della rev. B (vedi tabella delle modifiche, punto 1).
- Uscita disabilitata: **20 mV** sul morsetto (multimetro). ✔
- Spegnimento automatico: uscita a 5 V, WiFi del telefono spento → bip e uscita a 0 V entro circa 12 s. ✔

### 5.2 Uscita corrente 4–20 mA (P1.3 mA+ / P1.1 COM), carico 503 Ω

| Impostato | Teorico | Multimetro in serie | Tensione ai capi di 503 Ω (senza multimetro) |
|---|---|---|---|
| 4 mA | 4,0000 mA | 4,01 mA | 2 V |
| 8 mA | 8,0000 mA | 8,02 mA | 4 V |
| 12 mA | 12,0000 mA | 12,04 mA | 6 V |
| 16 mA | 16,0000 mA | 16,05 mA | 8 V |
| 20 mA | 19,9961 mA | 20,00 mA | 10 V |

Scarti fino a +0,05 mA (+0,3%), pari all'incertezza del multimetro in mA; il loopback della fase 6 mostra che l'uscita
reale è leggermente **bassa** (−0,11%), quindi lo scarto positivo è del multimetro. ✔

- Circuito aperto su P1.3: **FAULT attivo** e bit **"IOUT fault"** nel registro di stato (AD5412.pdf Tab. 21). ✔

## Fase 6 — Ingressi ADS1220 in loopback con le uscite

Collegamenti: tensione P1.4 V+ → P2.2 V+, P1.1 COM → P2.1 V−; corrente P1.3 mA+ → P2.4 mA+, P2.3 mA− → P1.1 COM.
Canale tensione AIN2–AIN3, guadagno 1, partitore 90,9 kΩ / 10 kΩ 0,05%; canale corrente AIN0–AIN1, guadagno 2, shunt R34 25,5 Ω 0,05%.
Riferimento interno 2,048 V, 20 SPS, filtro 50/60 Hz, media mobile di 10 letture. Valori **senza calibrazione**.

### 6.1 Tensione

Confronto a 2 decimali con il multimetro sullo stesso nodo:

| Impostato | ADS1220 | Multimetro |
|---|---|---|
| 2,5 V | 2,49 V | 2,49 V |
| 5 V | 4,99 V | 4,99 V |
| 7,5 V | 7,500 V | 7,49 V |
| 10 V | 9,99 V | 9,99 V |

Lettura a 4 decimali contro il teorico del DAC:

| Impostato | Teorico DAC | ADS1220 | Scarto |
|---|---|---|---|
| 0 V | 0,0000 V | 0,0009 V | +0,9 mV |
| 2,5 V | 2,5000 V | 2,4990 V | −1,0 mV |
| 5 V | 5,0000 V | 4,9997 V | −0,3 mV |
| 7,5 V | 7,5000 V | 7,5004 V | +0,4 mV |
| 10 V | 9,9976 V | 9,9994 V | +1,8 mV |

- Accordo DAC ↔ ADC **entro ±2 mV su 10 V (±0,02%)**. ✔
- Rumore a 10 V (min…max della media mobile): 9,9992…9,9994 V = **0,2 mV picco-picco**. ✔
- Zero con P2 senza fili: **0,0004 V**. ✔

### 6.2 Corrente

| Impostato | Teorico DAC | ADS1220 | Scarto |
|---|---|---|---|
| 4 mA | 4,0000 mA | 3,9982 mA | −1,8 µA |
| 8 mA | 8,0000 mA | 7,9929 mA | −7,1 µA |
| 12 mA | 12,0000 mA | 11,9887 mA | −11,3 µA |
| 16 mA | 16,0000 mA | 15,9837 mA | −16,3 µA |
| 20 mA | 19,9961 mA | 19,9762 mA | −19,9 µA |

- Retta: I_ADC = **0,998865 × I_DAC + 2,3 µA** → guadagno **−0,11%**, residui ±0,5 µA. Lo scarto viene da RSET (15 kΩ 0,1%) e/o dallo shunt R34 (0,05%). ✔
- Rumore a 20 mA: 19,9761…19,9765 mA = **0,4 µA picco-picco**. ✔
- Zero (uscita a 0 mA): **0,0006 mA**. ✔
- I riferimenti interni di AD5412 (5 V) e ADS1220 (2,048 V, 2,045–2,051 V a 25 °C, ads1220.pdf §6.5) concordano entro 0,02%:
  l'ADS1220 è il riferimento migliore disponibile sulla scheda.

## Fase 7 — Sink 2 fili (simulazione trasmettitore, P1.2 SIM+ / P1.1 COM)

Circuito: setpoint = tensione V_SENSE dell'AD5412 (modo 0–10 V) × 1 kΩ / 16,4 kΩ su R16 25,5 Ω → **2,391 mA/V**; OP184 + Q2 IRLR3110Z.
Interlock: GPIO38 ALTO = sink disabilitato (Q1 AO3400A, R12 100 kΩ pull-up). Prova: alimentatore 24 V → 503 Ω → P1.2 SIM+, P1.1 COM → 0 V.

### 7.1 Prima misura (multimetro in serie, portata 20 mA)

| Impostato | Teorico | Misurato | Scarto |
|---|---|---|---|
| 4 mA | 3,999 mA | 4,12 mA | +0,12 mA |
| 8 mA | 7,998 mA | 8,13 mA | +0,13 mA |
| 12 mA | 12,003 mA | 12,13 mA | +0,13 mA |
| 16 mA | 16,002 mA | 16,13 mA | +0,13 mA |
| 20 mA | 20,001 mA | 0.L (fuori portata), poi 20 mA sulla portata 200 mA | — |

### 7.2 Tensione ai capi del carico 503 Ω (senza multimetro in serie)

| Impostato | V su 503 Ω | Corrente calcolata (V/503 Ω) | Scarto |
|---|---|---|---|
| 4 mA | 2,07 V | 4,115 mA | +0,116 mA |
| 8 mA | 4,07 V | 8,091 mA | +0,093 mA |
| 12 mA | 6,10 V (prima lettura 6,09 V) | 12,127 mA | +0,124 mA |
| 16 mA | 8,08 V | 16,064 mA | +0,062 mA |
| 20 mA | 10,03 V | 19,940 mA | −0,061 mA |

L'andamento non lineare è un errore di misura: la resistenza da 503 Ω dissipa fino a 0,2 W a 20 mA e cambia valore scaldandosi.

### 7.3 Ricerca della causa

| Prova | Atteso | Misurato | Conclusione |
|---|---|---|---|
| Sink disabilitato (GPIO38 ALTO), 24 V applicati, tensione sul 503 Ω | 0 | **0,01 mV** (≈ 20 nA) | Nessuna dispersione; D8 SMAJ33CA non conduce. Interlock ✔ |
| Sink 12 mA: V_SENSE (P1.4 V+ – P1.1 COM) | 5,020 V | **5,01 V** | Setpoint DAC ✔ |
| Sink 12 mA: OP_+ (ai capi di R20) | 0,3055 V | **0,307 V** | Partitore R19/R20 ≈ +0,5% |
| Sink 12 mA: OP_− (ai capi di R16) | = OP_+ | **0,308 V** | L'OP184 regola (scarto ≤ 1 mV) ✔ |

### 7.4 Corrente reale da V(R16) / 25,5 Ω

| Impostato | Teorico | V(R16) | Corrente | Scarto |
|---|---|---|---|---|
| 4 mA | 3,999 mA | 104,6 mV | 4,102 mA | +0,103 mA |
| 8 mA | 7,998 mA | 207 mV | 8,118 mA | +0,120 mA |
| 12 mA | 12,003 mA | 308 mV | 12,078 mA | +0,076 mA |
| 16 mA | 16,002 mA | 409 mV | 16,039 mA | +0,038 mA |
| 20 mA | 20,001 mA | 510 mV | 20,000 mA | −0,001 mA |

Retta: I = 0,99277 × I_teorico + 0,154 mA, residui ±0,024 mA (lineare). R16 è però **25,5 Ω ±1%, 75 ppm/°C, film spesso**,
quindi non è un riferimento valido: la calibrazione è stata fatta contro l'ingresso corrente dell'ADS1220 (shunt 0,05%).

### 7.5 Calibrazione in loopback (P2.5 L+ → P1.2 SIM+, P1.1 COM → P2.4 mA+), salvata in NVS il 01/10/2026 00:33:54

| Punto | Teorico | Misurato ADS1220 | Scarto |
|---|---|---|---|
| 4 mA | 3,9990 mA | 4,1042 mA | +105,2 µA |
| 8 mA | 7,9979 mA | 8,1106 mA | +112,7 µA |
| 12 mA | 12,0027 mA | 12,0952 mA | +92,5 µA |
| 16 mA | 16,0017 mA | 16,0717 mA | +70,0 µA |
| 20 mA | 20,0006 mA | 19,9839 mA | −16,7 µA |

Coefficienti: **gain 0,992840, offset +158,7 µA**.

| Verifica con la correzione | Misurato ADS1220 | Errore | % su 16 mA |
|---|---|---|---|
| 4 mA | 3,9711 mA | −28,9 µA | −0,181% |
| 12 mA | 12,0218 mA | +21,8 µA | +0,136% |
| 20 mA | 19,9661 mA | −33,9 µA | −0,212% |

- Senza calibrazione: errore fino a **+0,70% di 16 mA**. Con calibrazione: **±0,21%**, dentro l'obiettivo ±0,3%. ✔
- Residuo con curvatura di ±30 µA, probabilmente termico (Q2 scalda R16, 75 ppm/°C). Deriva stimata di R16 da sola: ±0,19% su ±25 °C.
- La corrente del sink non è misurata dallo strumento (rev. B): loop aperto o invertito non vengono segnalati.

## Fase 8 — Protezioni

Tutte con alimentatore 24 V limitato (50 mA, salvo indicazione), scheda alimentata da USB.

| Prova | Condizioni | Misurato | Esito |
|---|---|---|---|
| 8.1 Sink, polarità invertita | +24 V → P1.1 COM, −24 V → 503 Ω → P1.2 SIM+, sink 12 mA | 0 V sul 503 Ω, 0 mA sull'alimentatore; poi polarità giusta: sink funzionante | ✔ D6 blocca |
| 8.2 +24 V sull'ingresso tensione | +24 V → P2.2 V+, −24 V → P2.1 V− | Pagina "FUORI SCALA"; tolta la tensione, lettura normale | ✔ |
| 8.3 −24 V sull'ingresso tensione | +24 V → P2.1 V−, −24 V → P2.2 V+ | Pagina −0,3897 V (lettura non valida sotto AVSS − 0,1 V, ads1220.pdf §6.3); 0 mA sull'alimentatore; 24 V misurati fra P2.1 e P2.2; poi normale. D14 = SMAJ33CA bidirezionale, non conduce | ✔ (aggiunto l'avviso "NEGATIVA") |
| 8.4 Cortocircuito uscita tensione | Uscita 10 V, P1.4 V+ – P1.1 COM in corto con il multimetro (portata mA) per ≤ 10 s | **16,60 mA**, nessuna sovratemperatura (chip a circa 35 °C), dopo il corto **9,98 V** | ✔ (corrente di corto tip. 20 mA, AD5412.pdf Tab. 2) |
| 8.5 Uscita corrente aperta | P1.3 mA+ scollegato | FAULT + "IOUT fault" | ✔ |
| 8.8 +24 V su P1.3 mA+ | Uscita disabilitata / abilitata a 4 mA | Disabilitata: circa 24 V sul display, corrente ≈ 0. Abilitata: FAULT + "IOUT fault" | ✔ |
| 8.9 L+ in cortocircuito su mA+ | P2.5 L+ → P2.4 mA+ | **26,6 mA** letti dall'ADS1220 | ✔ limitatore U10 LM317LDR2G + R28 47 Ω (1,25 V / 47 Ω = 26,6 mA) |
| 8.6 +24 V diretti su mA+/mA− | — | **Non eseguita** (stress sullo shunt R34 0,05%) | — |

- Dopo 8.8 (loopback 9c a 20 mA) i loopback in tensione e in corrente sono identici a quelli della fase 6.
- Componenti verificati: D5 = D9 = BAT54S; D8 = SMAJ33CA; D12 = SMAJ33CA; D14 = SMAJ33CA; U10 = LM317LDR2G (U10 e R28 non scaldano).

## Fase 9 — Isolamento 500 V

**Non eseguita**: manca il misuratore d'isolamento. Va fatta prima dell'uso su impianti reali (logica ↔ COM_OUT ↔ COM_IN).

## Fase 10 — Consumi a 5 V (misuratore USB)

| # | Condizione | Misurato | Atteso (budget a 5 V) | Esito |
|---|---|---|---|---|
| S1 | Riposo: uscite spente, telefono collegato, pagina aperta | **253 mA** | 250–320 mA | ✔ |
| S2 | Uscita corrente 20 mA su 503 Ω | **375 mA** (+122 mA) | riposo + ≈ 120 mA (regola ×6) | ✔ |
| S3 | Sink 20 mA da L+ (prima prova) | 270 mA | ≈ 373 mA | ✘ non valida: loop aperto |
| S4 | Massimo realistico (S3 + LED bianco, LED test, cicalino continuo 4 kHz, scansione WiFi a 19,5 dBm), prima prova | 357 mA | 480–550 mA | ✘ non valida: loop aperto |
| S4 | Massimo realistico, ripetuta con il loop chiuso | **470 mA** | tipico 480–550 mA, massimo 1,1–1,2 A | ✔ |

Fra S4 con il loop aperto e chiuso: +113 mA, coerente con 20 mA a 24 V (≈ 120 mA a 5 V). Massimo realistico ≈ 24% dei 2 A
richiesti al powerbank. **Corrente d'avvio non misurata.**

Alimentatori isolati: **AVDD 23,5 V** (uscita AD5412), **L+ 23,9 V a vuoto** (P2.5 L+ – P2.3 mA−). Una prima lettura di L+ = 0 V era un errore di misura.

## Fase 11 — Prove funzionali successive

### 11.1 Compliance dell'uscita corrente e FAULT per carico eccessivo

Loop: P1.3 mA+ → 1 kΩ in serie → P2.4 mA+, P2.3 mA− → P1.1 COM. Resistenza totale del loop stimata 1,11–1,14 kΩ
(1 kΩ + R17 33 Ω + R18 47 Ω + shunt 25,5 Ω + due PPTC 1,6–15 Ω ciascuno).

| Impostato | FAULT | Corrente letta su P2.4 |
|---|---|---|
| 16 mA | No | — |
| 20 mA | **Sì** | **19,0215 mA** |

- Tensione massima raggiunta su IOUT: 19,02 mA × 1,11–1,14 kΩ ≈ **21,1–21,7 V**; con AVDD 23,5 V il margine reale è **1,8–2,4 V**.
  Specifica: compliance AVDD − 2,5 V (AD5412.pdf Tab. 2, "Current Loop Compliance Voltage") → il chip fa leggermente meglio.
- Il FAULT si attiva prima di perdere la regolazione (AD5412.pdf, sezione "Fault Alert"). ✔
- Carico esterno massimo a 20 mA: **≈ 955 Ω garantiti**, ≈ 960–1000 Ω misurati.

### 11.2 Spegnimento automatico, LED e cicalino

| Prova | Esito |
|---|---|
| App chiusa con un'uscita attiva → uscita spenta, LED da arancio a verde, bip 2 kHz | ✔ |
| LED verde a riposo: luminosità ridotta da 160 a 40 / 255 su richiesta (troppo acceso) | ✔ |

### 11.3 App Android IO Tester 1.1 — Samsung Galaxy A54 (SM-A546B), Android 16

| Prova | Esito |
|---|---|
| Installazione via adb (`Performing Streamed Install — Success`) | ✔ |
| Collegamento al WiFi IO-Tester: RSSI −50 dBm, 72 Mbit/s, 11n canale 1, IP 192.168.4.2 | ✔ |
| Strumento acceso dopo l'avvio dell'app → interfaccia aperta da sola | ✔ |
| Rete dimenticata → Android chiede la conferma, poi apre l'interfaccia | ✔ |
| App chiusa con uscita attiva → lo strumento spegne l'uscita | ✔ |

### 11.4 Calibrazione delle uscite tensione e corrente

La pagina Home del telefono (2026-10-01 18:59) mostra **3 canali su 5 calibrati**: oltre al sink risultano calibrate uscita
tensione e uscita corrente. **Coefficienti e verifiche non comunicati**: da riportare (pagina Info app → Copia dei coefficienti).
Gli ingressi non vanno calibrati con il multimetro a 2 decimali disponibile (errore di risoluzione fino a ±0,5% a 1 V).

---

## Limiti noti della rev. B e modifiche proposte per la revisione successiva

| # | Problema | Effetto misurato | Modifica proposta |
|---|---|---|---|
| 1 | F1 fuori dall'anello +VSENSE | −0,8% con 1 kΩ (5.1); fino a −1,5% con R_F1 max 15 Ω | +VSENSE dopo F1, con protezione del pin |
| 2 | D5, D9 BAT54S (V_R 30 V) | Con 28,8 V esterni il diodo verso −4 V vede ≈ 32,8 V | BAS40-04 (40 V, SOT-23; verificare piedinatura e LCSC) |
| 3 | R16, R19, R20 al 1% / 75 ppm/°C | Sink +0,70% senza calibrazione (7.5), deriva ±0,19% su ±25 °C | 0,1% / ≤ 25 ppm/°C, R16 lontana da Q2 |
| 4 | Corrente del sink non monitorata | Loop aperto non segnalato (S3/S4 con loop aperto non rilevati) | Comparatore su saturazione OP184 in OR sulla linea FAULT |
| 5 | Bleeder dei B0524S-2WR3 (5,1 kΩ = 4,7 mA) e B0505S | Sotto il carico minimo del 10% (8,3 mA) | Ridimensionare i bleeder o usare la versione da 1 W |

## Prove ancora da eseguire

- [ ] Riportare in questo rapporto i coefficienti di calibrazione di uscita tensione e uscita corrente (11.4)
- [ ] Fase 9: isolamento 500 V DC fra logica, COM_OUT e COM_IN
- [ ] Verifica metrologica con strumento ≥ 5½ cifre (obiettivo ±0,3%) e calibrazione degli ingressi
- [ ] Prova su PLC reale (SM 331 / 6ES7135), compresi i valori NAMUR NE 43
- [ ] Deriva in temperatura
- [ ] Corrente d'avvio (picco) a 5 V; consumo con alimentazione 24 V
- [ ] VUSB sotto carico massimo (S4)
- [ ] 8.6, eventualmente su un secondo esemplare
- [ ] Sigle di D16, D17, F4, Q3 (ingresso 24 V)
