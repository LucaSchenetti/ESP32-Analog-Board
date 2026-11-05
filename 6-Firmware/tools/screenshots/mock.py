# IO Tester — server finto di /api/* per le schermate dell'interfaccia / fake /api/* server for UI screenshots
# IT: Serve data/ e risponde alle API con valori simulati (uscite riportate sugli ingressi, simulatore con PI del "PLC").
#     Parametri nell'URL di una pagina: theme, lang, tab (simulatore), pg (prove: conv | valve).
# EN: Serves data/ and answers the APIs with simulated values (outputs looped to the inputs, simulator with a "PLC" PI).
#     Page URL parameters: theme, lang, tab (simulator), pg (tests: conv | valve).
# Uso / usage: python3 mock.py <cartella data/>   → http://localhost:8765/
import http.server, json, random, time, os, sys, math, urllib.parse
os.chdir(sys.argv[1]); t0 = time.time()
NC = [182344]
OUT = {"mode": 0, "sink": False, "value": 0.0}
SIMC = {"model": 0, "gain": 1, "t1": 2, "t2": 3, "dead": 0.5, "tfill": 120, "outflow": 50, "pv0": 0, "stroke": 3, "db": 0.3, "eq": False, "noise": 0.5, "in": 1, "out": 1}
SIMD = {"load": 0, "amp": 0, "period": 30, "drift": 0}
SIMS = {"running": False}

def sim_reset():
    """IT: Riparte la simulazione. EN: Restarts the simulation."""
    SIMS.update(running=True, t=0.0, x1=0.0, valve=0.0, pv=0.0, pvm=0.0, mv=0.0, i=0.0, buf=[], hist=[], seq=0, fault=0)

def sim_adv(sec):
    """IT: Avanza di sec secondi: PI 30 → 60 % a 20 s, valvola, processo. EN: Advances sec seconds: PI 30 → 60 % at 20 s, valve, process."""
    c = SIMC; dt = 0.05
    for _ in range(int(sec / dt)):
        t = SIMS["t"]; sp = 30 if t < 20 else 60
        kc, ti = 0.8, 2.5
        e = sp - SIMS["pvm"]
        SIMS["i"] = max(-50, min(150, SIMS["i"] + kc * e / ti * dt))
        SIMS["mv"] = max(0, min(100, kc * e + SIMS["i"]))
        vmax = 100 / max(c["stroke"], 0.05) * dt
        SIMS["valve"] += max(-vmax, min(vmax, SIMS["mv"] - SIMS["valve"]))
        SIMS["buf"].append(SIMS["valve"] + SIMD["load"]); nd = int(c["dead"] / dt)
        ud = SIMS["buf"][-nd - 1] if len(SIMS["buf"]) > nd else 0
        SIMS["buf"] = SIMS["buf"][-1300:]
        SIMS["x1"] += dt / max(c["t1"], dt) * (c["gain"] * ud - SIMS["x1"])
        SIMS["pv"] = c["pv0"] + SIMS["x1"]
        SIMS["pvm"] = SIMS["pv"] + c["noise"] * random.gauss(0, 1)
        SIMS["t"] = t + dt
        if round(SIMS["t"] / dt) % 4 == 0:
            SIMS["seq"] += 1; SIMS["hist"].append([round(SIMS["t"], 1), SIMS["mv"], SIMS["valve"], SIMS["pvm"]]); SIMS["hist"] = SIMS["hist"][-600:]

def sim_state(since):
    """IT: Risposta di /api/sim/state. EN: /api/sim/state reply."""
    base = {"cfg": SIMC, "dist": SIMD, "dac_fault": False, "mv_bad": False, "drift_acc": 0}
    if not SIMS["running"]:
        return {**base, "running": False, "t": 0, "mv_sig": 0, "mv": 0, "valve": 0, "pv": 0, "pv_meas": 0, "out_sig": 0, "fault": 0, "seq": 0, "hist": []}
    sim_adv(1.0)
    n = SIMS["seq"] - since
    return {**base, "running": True, "t": SIMS["t"], "mv_sig": 4 + 0.16 * SIMS["mv"], "mv": SIMS["mv"], "valve": SIMS["valve"], "pv": SIMS["pv"],
            "pv_meas": SIMS["pvm"], "out_sig": 4 + 0.16 * SIMS["pvm"], "fault": SIMS["fault"], "seq": SIMS["seq"], "hist": SIMS["hist"][-n:] if n > 0 else []}

def state():
    """IT: Risposta di /api/state. EN: /api/state reply."""
    k = time.time() - t0; NC[0] += 5
    v = 4.0 + 0.3 * math.sin(k / 9) + random.uniform(-0.0003, 0.0003)
    i = 12.07 + 0.05 * math.sin(k / 7) + random.uniform(-0.0004, 0.0004)
    if OUT["mode"] == 1: v = OUT["value"] + 0.0004 + random.uniform(-0.0002, 0.0002)
    if OUT["mode"] in (2, 3) or OUT["sink"]: i = OUT["value"] + 0.0012 + random.uniform(-0.0003, 0.0003)
    calc = lambda ok, g=1, o=0: {"valid": ok, "gain": g, "offset": o, "date": 1790810034 if ok else 0, "temp": 34.9 if ok else None}
    run = SIMS.get("running", False)
    mode = 4 if run else OUT["mode"]; val = OUT["value"]
    code = int(val / (10 if mode == 1 else 20) * 4095) if mode else 0
    return {"fw": "0.0.6", "uptime": int(4523 + k), "clients": 1, "vusb": 5.012, "ext24": False, "ext5": True, "temp": 34.94,
            "out": {"mode": mode, "sink": OUT["sink"], "sim": run, "value": val, "nominal": val, "code": code, "code_rb": code,
                    "ctrl": {0: 0, 1: 0x1001, 2: 0x3005, 3: 0x3006, 4: 0x3007}[mode], "calibrated": True, "fault": False, "status": 0, "selftest": True},
            "in": {"v": v, "v_min": v - 0.0002, "v_max": v + 0.0002, "i": i, "i_min": i - 0.0003, "i_max": i + 0.0002, "v_nom": v, "i_nom": i,
                   "code_v": 1639000, "code_i": 2523000, "sat_v": False, "sat_i": False, "n": NC[0], "err": 0, "selftest": True},
            "esp": {"temp": 41.5, "heap": 231234, "heap_min": 198765, "cpu": 240, "reset": "poweron"},
            "wifi": {"ssid": "IO-Tester", "ch": 1, "tx": 19.5, "rssi": -48},
            "cal": {"sink": calc(True, 0.99284, 0.1587), "vout": calc(True, 0.998902, -0.0021), "iout": calc(True, 1.001104, 0.0123), "vin": calc(False), "iin": calc(False)}}

EXTRA = {
    "/api/power": {"vusb_mv": 5012, "pin_mv": 1531, "atten": 11, "ext24": False, "ext5": True, "ok": True},
    "/api/dac/status": {"mode": 0, "code": 0, "code_rb": 0, "ctrl_rb": 0, "status_rb": 0, "theory": 0, "fault": False, "sink": False, "sink_ma": 0},
    "/api/antenna": {"tx_dbm": 19.5, "channel": 1, "stations": [{"mac": "A4:C6:9A:12:7F:3E", "rssi": -48}], "scanning": False,
                     "scan": [{"ssid": "Officina", "rssi": -61, "channel": 6}, {"ssid": "PLC-Lab", "rssi": -72, "channel": 11}]},
    "/api/update/info": {"fw": "0.0.6", "built": "Oct 11 2026 00:41:12", "idf": "v4.4.7", "running": "app0", "next": "app1",
                         "app_max": 3407872, "sketch": 921632, "fs_size": 1441792, "fs_used": 612352, "pin_default": True,
                         "nvs_used": 63, "nvs_total": 630, "ok": True},
}

PRE = ("<script>(function(){const p=new URLSearchParams(location.search);try{"
       "if(p.get('theme'))localStorage.setItem('iotester.theme',p.get('theme'));"
       "if(p.get('lang'))localStorage.setItem('iotester.lang',p.get('lang'));"
       "if(p.get('tab'))localStorage.setItem('iotester.pid.tab',p.get('tab'));"
       "if(p.get('pg')){let c={};try{c=JSON.parse(localStorage.getItem('iotester.tests')||'{}')}catch(e){}"
       "c.mode=p.get('pg');localStorage.setItem('iotester.tests',JSON.stringify(c));}"
       "}catch(e){}})();</script>")

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, o):
        b = json.dumps(o).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == '/api/state': return self.send_json(state())
        if u.path == '/api/sim/state': return self.send_json(sim_state(int(q.get("since", ["0"])[0])))
        if u.path in EXTRA: return self.send_json(EXTRA[u.path])
        if u.path.startswith('/api/'): return self.send_json({"ok": True})
        p = '/index.html' if u.path == '/' else u.path
        if p.endswith('.html') and u.query and os.path.exists(p[1:]):
            h = open(p[1:]).read().replace('<head>', '<head>' + PRE, 1).encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.send_header('Content-Length', str(len(h)))
            self.end_headers(); self.wfile.write(h); return
        self.path = p
        super().do_GET()
    def do_POST(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == '/api/sim/start':
            for k, v in q.items():
                if k in SIMC: SIMC[k] = float(v[0])
            if not SIMS.get("running") or q.get("reset", ["0"])[0] == "1": sim_reset()
        elif u.path == '/api/sim/stop': SIMS["running"] = False
        elif u.path == '/api/out/off': SIMS["running"] = False; OUT.update(mode=0, sink=False, value=0.0)
        elif u.path == '/api/out/v': OUT.update(mode=1, sink=False, value=float(q["value"][0]))
        elif u.path == '/api/out/i': OUT.update(mode=3 if q.get("range", ["1"])[0] == "0" else 2, sink=False, value=float(q["value"][0]))
        elif u.path == '/api/out/sink': OUT.update(mode=0, sink=True, value=float(q["value"][0]))
        self.send_json({"ok": True} if u.path.startswith('/api/sim') else state())

http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
