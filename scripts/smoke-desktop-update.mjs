// Runs only on disposable CI machines. Exercise the installed host/renderer IPC,
// live GitHub feed, verified download, package installation, and automatic relaunch.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'upgrade smoke is restricted to disposable CI runners');
assert.ok(['linux', 'win32'].includes(process.platform));
const exe = process.env.INJOFFICE_TEST_EXE;
assert.ok(exe, 'INJOFFICE_TEST_EXE is required');
const output = resolve('desktop-upgrade-output');
mkdirSync(output, {recursive: true});
const archive = resolve(dirname(exe), 'resources/app.asar');
const version = () => { asar.uncache(archive); return JSON.parse(asar.extractFile(archive, 'package.json')).version; };
assert.equal(version(), '0.0.0');
const child = spawn(exe, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9224'], {stdio: ['ignore', 'pipe', 'pipe']});
let logs = '', socket, spawnError, sequence = 0;
const pending = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
child.on('error', error => {spawnError = error;});
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {logs = `${logs}${chunk}`.slice(-64000);});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id); reject(new Error(`CDP timeout: ${method}`));}, 30000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(probe, label, duration = 90000) {
  const deadline = Date.now() + duration;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (await probe()) return;
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${label}\n${logs}`);
}
function runningPids() {
  if (process.platform === 'win32') {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process -Name InjOffice -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ","'], {encoding: 'utf8'}).trim();
    return raw ? raw.split(',').map(Number) : [];
  }
  try { return execFileSync('pgrep', ['-f', '^/opt/InjOffice/injoffice'], {encoding: 'utf8'}).trim().split(/\s+/).map(Number); }
  catch { return []; }
}
try {
  let target;
  await until(async () => {
    assert.equal(child.exitCode, null, `App exited during startup: ${logs}`);
    try {
      const response = await fetch('http://127.0.0.1:9224/json/list', {signal: AbortSignal.timeout(1000)});
      target = (await response.json()).find(item => item.type === 'page' && item.url === 'injoffice://app/index.html');
      return !!target?.webSocketDebuggerUrl;
    } catch {return false;}
  }, 'installed application startup');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', reject, {once: true});
  });
  socket.addEventListener('close', () => {
    for (const task of pending.values()) {clearTimeout(task.timer); task.reject(new Error('App debugging connection closed'));}
    pending.clear();
  });
  socket.addEventListener('message', ({data}) => {
    const message = JSON.parse(data);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  await until(async () => await evaluate('!!window.injDesktop && !!document.querySelector(".start-create-xlsx")'), 'Home screen');
  const baseline = await evaluate('window.injDesktop.getUpdateState()');
  assert.equal(baseline.appVersion, '0.0.0');
  assert.equal(baseline.manualInstall, false, 'the test must exercise native installation, not a browser fallback');
  const available = await evaluate('window.injDesktop.checkForUpdates()');
  assert.equal(available.status, 'available', JSON.stringify(available));
  assert.match(available.version, /^\d+\.\d+\.\d+$/);
  console.log(`Installed baseline discovered ${available.version}; downloading through the host IPC.`);
  await evaluate('void window.injDesktop.downloadUpdate(); true');
  await until(async () => {
    const state = await evaluate('window.injDesktop.getUpdateState()');
    assert.notEqual(state.status, 'error', JSON.stringify(state));
    return state.status === 'downloaded';
  }, 'verified in-app download', 240000);
  const oldPids = new Set(runningPids());
  console.log('Download verified; installing and restarting through the host IPC.');
  await evaluate('void window.injDesktop.installUpdate(); true');
  await until(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    try {
      const state = await evaluate('window.injDesktop.getUpdateState()');
      assert.ok(state.status !== 'downloaded' || !state.message, JSON.stringify(state));
      assert.notEqual(state.status, 'error', JSON.stringify(state));
    } catch (error) {
      if (child.exitCode !== null || socket.readyState !== WebSocket.OPEN) return true;
      throw error;
    }
    return false;
  }, 'old application to quit', 180000);
  await until(async () => {
    try { return version() === available.version && runningPids().some(pid => !oldPids.has(pid)); }
    catch { return false; }
  }, 'new version to be installed and automatically relaunched', 180000);
  const result = {platform: process.platform, architecture: process.arch, from: baseline.appVersion, to: version(), downloadedInApp: true, installed: true, relaunched: true};
  writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log('PASS:', JSON.stringify(result));
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try {
      const state = await evaluate('window.injDesktop.getUpdateState()');
      writeFileSync(resolve(output, 'update-state.json'), JSON.stringify(state, null, 2));
    } catch { /* Preserve process output if the old renderer has closed. */ }
  }
  writeFileSync(resolve(output, 'electron.log'), logs);
  for (const task of pending.values()) clearTimeout(task.timer);
  socket?.close();
  // These names belong only to our app on the disposable runner, including the
  // relaunched process which is no longer a child of this test process.
  if (process.platform === 'win32') {
    try {execFileSync('taskkill.exe', ['/F', '/IM', 'InjOffice.exe', '/T'], {stdio: 'ignore'});} catch {}
  } else {
    for (const pid of runningPids()) {try {process.kill(pid, 'SIGTERM');} catch {}}
  }
}
