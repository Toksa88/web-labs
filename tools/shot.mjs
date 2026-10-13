// Скріншоти сторінок для звітів через headless Microsoft Edge (Chrome DevTools Protocol).
// Використання: node tools/shot.mjs <file-or-url> <out.png> [width=1366] [height=768] [full | y=<від>,<висота>]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [target, out, w = '1366', h = '768', mode] = process.argv.slice(2);
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
const width = +w, height = +h;

const profile = mkdtempSync(join(tmpdir(), 'edge-shot-'));
const port = 9300 + Math.floor(Math.random() * 500);
const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* Edge ще стартує */ }
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg.method);
});
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});

const mobile = width < 768;
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
await send('Page.navigate', { url });
for (let i = 0; i < 100 && !events.includes('Page.loadEventFired'); i++) await sleep(100);
await sleep(1200); // шрифти Google Fonts

let clip;
if (mode === 'full') {
  const { result } = await send('Runtime.evaluate', {
    expression: 'Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)',
    returnByValue: true,
  });
  clip = { x: 0, y: 0, width, height: result.result.value, scale: 1 };
} else if (mode?.startsWith('y=')) {
  // фрагмент сторінки: y=<звідки>,<висота>
  const [y, ch] = mode.slice(2).split(',').map(Number);
  clip = { x: 0, y, width, height: ch, scale: 1 };
}
const format = /\.jpe?g$/i.test(out) ? 'jpeg' : 'png';
const shot = await send('Page.captureScreenshot', {
  format, ...(format === 'jpeg' ? { quality: 82 } : {}),
  ...(clip ? { clip, captureBeyondViewport: true } : {}),
});
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);

ws.close();
edge.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* профіль ще зайнятий */ }
process.exit(0);
