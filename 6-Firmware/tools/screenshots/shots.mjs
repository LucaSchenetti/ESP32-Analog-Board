/*
  IO Tester — schermate a pagina intera dell'interfaccia / full-page screenshots of the interface
  IT: Apre Chrome headless con il protocollo DevTools e fotografa le pagine servite da mock.py.
      Variabili: LG (it | en → suffisso _EN), W/H/DPR (predefinito telefono 390×844 ×3; con W = computer), ONLY (nomi separati da virgola).
  EN: Opens headless Chrome via the DevTools protocol and captures the pages served by mock.py.
      Variables: LG (it | en → _EN suffix), W/H/DPR (default phone 390×844 ×3; with W = desktop), ONLY (comma-separated names).
  Uso / usage: node --experimental-websocket shots.mjs <cartella di uscita> <dark|light>
*/
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , OUTDIR, THEME = 'dark'] = process.argv;
const LG = process.env.LG || 'it';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const W = +(process.env.W || 390), H = +(process.env.H || 844), DPR = +(process.env.DPR || 3), MOB = !process.env.W;
const BASE = 'http://localhost:8765/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prof = mkdtempSync(join(tmpdir(), 'iot-cdp-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  `--user-data-dir=${prof}`, '--remote-debugging-port=9333', 'about:blank'], { stdio: 'ignore' });
let tgt;
for (let k = 0; k < 50 && !tgt; k++) {
  await sleep(200);
  try { tgt = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((x) => x.type === 'page'); } catch (e) { /* IT/EN: Chrome in avvio / starting */ }
}
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pend = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); }
});

/** IT: Comando DevTools. EN: DevTools command. */
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
/** IT: Dimensioni dello schermo emulato. EN: Emulated screen size. */
const metrics = (h) => cmd('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: DPR, mobile: MOB });
/** IT: POST al server finto. EN: POST to the fake server. */
const post = (p) => fetch(BASE + p, { method: 'POST' });
/** IT: Valuta JavaScript nella pagina. EN: Evaluates JavaScript in the page. */
const js = async (e) => (await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
/** IT: Altezza del contenuto. EN: Content height. */
const height = async () => Math.max(H, Math.ceil(await js('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')));
await cmd('Page.enable');
await cmd('Runtime.enable');

/**
 * IT: Fotografa una pagina (intera o solo lo schermo). EN: Captures a page (full or viewport only).
 */
async function shot(name, page, { before, after, full = true } = {}) {
  if (ONLY && !ONLY.includes(name)) return;
  if (before) await before();
  await metrics(H);
  await cmd('Page.navigate', { url: `${BASE}${page}${page.includes('?') ? '&' : '?'}theme=${THEME}&lang=${LG}` });
  await sleep(2500);
  if (after) { await after(); await sleep(1200); }
  let h = H;
  if (full) {
    h = await height(); await metrics(h); await sleep(500);
    h = await height(); await metrics(h); await sleep(400);
  }
  const r = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUTDIR}/${name}${LG === 'en' ? '_EN' : ''}.png`, Buffer.from(r.data, 'base64'));
  console.log(name, h);
}

await post('api/out/off');
await shot('01_home', 'index.html');
if (MOB) await shot('02_menu', 'index.html', { full: false, after: () => js("document.getElementById('btn-menu').click()") });
await shot('03_genera_tensione', 'gen-v.html', { before: () => post('api/out/v?value=5.13') });
await shot('04_genera_corrente_4F', 'gen-i.html', { before: () => post('api/out/i?value=12') });
await shot('05_genera_corrente_2F', 'sim.html', { before: () => post('api/out/sink?value=12') });
await post('api/out/off');
await shot('06_misura_tensione', 'meas-v.html');
await shot('07_misura_corrente_4F', 'meas-i4.html');
await shot('08_misura_corrente_2F', 'meas-i2.html');
await shot('09_prove_guidate', 'prove.html?pg=conv');
await shot('09b_prove_valvola', 'prove.html?pg=valve');
if (!ONLY || ONLY.some((n) => n.startsWith('10'))) {
  await post('api/sim/start?reset=1');
  for (let k = 0; k < 60; k++) await fetch(BASE + 'api/sim/state');
}
await shot('10_simulatore_processo', 'pid.html?tab=dist');
await shot('10b_simulatore_scheda_processo', 'pid.html?tab=proc');
await shot('10c_simulatore_scheda_collega', 'pid.html?tab=wire');
await shot('10d_simulatore_scheda_pid', 'pid.html?tab=pid');
await post('api/out/off');
await shot('11_calibrazione', 'cal.html');
await shot('12_autotest', 'autotest.html');
await shot('13_diagnostica', 'diag.html');
await shot('14_collaudo', 'collaudo.html');
await shot('15_info_app', 'info.html');
ws.close();
await new Promise((r) => { chrome.on('exit', r); chrome.kill(); });
await sleep(300);
rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
