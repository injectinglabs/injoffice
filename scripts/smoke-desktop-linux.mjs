// Run only in an isolated Linux test session (CI supplies Xvfb).
// Exercise the installed executable with its normal Chromium sandbox enabled.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {terminateProcess} from './chrome-cdp-startup.mjs';

assert.equal(process.platform, 'linux', 'this smoke test requires Linux');
const output = resolve('desktop-smoke-output');
mkdirSync(output, {recursive: true});
const profile = mkdtempSync(resolve(tmpdir(), 'injoffice-desktop-smoke-'));
const child = spawn('/opt/InjOffice/injoffice', [
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9223',
  `--user-data-dir=${profile}`,
], {stdio: ['ignore', 'pipe', 'pipe']});
let logs = '', spawnError, socket, sequence = 0;
const pending = new Map();
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
child.on('error', error => { spawnError = error; });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = `${logs}${chunk}`.slice(-32000); });
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression, label) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    if (errors.length) throw new Error(errors.join('\n'));
    const alert = await evaluate(`document.querySelector('.app-error, .open-error, [role="alert"]')?.textContent`);
    if (alert) throw new Error(alert);
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
try {
  let target;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`App exited: ${child.exitCode ?? child.signalCode}\n${logs}`);
    try {
      const response = await fetch('http://127.0.0.1:9223/json/list', {signal: AbortSignal.timeout(1000)});
      const targets = await response.json();
      target = targets.find(item => item.type === 'page' && item.url === 'injoffice://app/index.html');
      if (target?.webSocketDebuggerUrl) break;
    } catch { /* The installed app may still be starting. */ }
    await delay(200);
  }
  assert.ok(target?.webSocketDebuggerUrl, `App did not expose its renderer\n${logs}`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener('error', error => { clearTimeout(timer); reject(error); }, {once: true});
  });
  socket.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id); clearTimeout(task.timer);
      if (message.error) task.reject(new Error(message.error.message));
      else task.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await until(`!!document.querySelector('.start-create-xlsx') && !document.querySelector('.start-create-xlsx').disabled`, 'enabled Home screen');
  assert.equal(await evaluate(`typeof window.injDesktop?.create`), 'function');
  const updateState = await evaluate('window.injDesktop.getUpdateState()');
  assert.notEqual(updateState.status, 'disabled', 'installed previews must expose update checks');
  assert.equal(updateState.autoCheck, true, 'update checks default to enabled');
  assert.equal(updateState.manualInstall, true, 'DEB updates use the OS installer');
  const checked = await evaluate('window.injDesktop.checkForUpdates()');
  assert.ok(['not-available', 'available'].includes(checked.status), `Live update check failed: ${JSON.stringify(checked)}`);
  await evaluate(`document.querySelector('.start-create-xlsx').click()`);
  await until(`!!document.querySelector('.editor-workspace:not([hidden]) [role="gridcell"]')`, 'new spreadsheet cells');
  assert.deepEqual(errors, []);
  const {data} = await send('Page.captureScreenshot', {format: 'png'});
  writeFileSync(resolve(output, 'spreadsheet.png'), Buffer.from(data, 'base64'));
  console.log('PASS: installed DEB launched, checked GitHub for updates, and created a native spreadsheet; sandbox was not disabled.');
} finally {
  writeFileSync(resolve(output, 'electron.log'), logs);
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      const state = await evaluate(`({url: location.href, text: document.body.innerText})`);
      writeFileSync(resolve(output, 'renderer.json'), JSON.stringify({state, errors}, null, 2));
    } catch { /* Keep process logs even when the renderer has failed. */ }
  }
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close();
  await terminateProcess(child);
}
