// Перевірка горизонтального переповнення сторінок на заданій ширині (headless Edge, CDP).
// Використання: node tools/overflow-check.mjs <width> <url-or-file>...
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [w, ...targets] = process.argv.slice(2);
const width = +w;
const port = 9800 + Math.floor(Math.random() * 100);
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'edge-ovf-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch { /* старт */ }
  if (!ws) await sleep(200);
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 768 });
let bad = 0;
for (const t of targets) {
  const url = /^https?:|^file:/.test(t) ? t : pathToFileURL(resolve(t)).href;
  await send('Page.navigate', { url });
  await sleep(1500);
  const { result } = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const vw = document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > vw + 1)
        .slice(0, 5).map((el) => el.tagName.toLowerCase() + '.' + el.className);
      return { vw, sw: document.documentElement.scrollWidth, wide };
    })()`,
  });
  const v = result.result.value;
  const ok = v.sw <= v.vw;
  if (!ok) bad++;
  console.log(ok ? 'OK  ' : 'OVF ', t, `scrollWidth=${v.sw} viewport=${v.vw}`, ok ? '' : v.wide.join(', '));
}
ws.close();
edge.kill();
process.exit(bad ? 1 : 0);
