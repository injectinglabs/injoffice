const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createUpdateService, updateAvailability, loadReleaseUpdater } = require('../electron/updates.cjs');

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'injoffice-updates-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const settingsPath = path.join(directory, 'updates.json');
  if (options.settings) await fs.writeFile(settingsPath, options.settings);
  const updater = new EventEmitter();
  updater.nativeUpdater = new EventEmitter();
  let loads = 0, checks = 0, downloads = 0, installs = 0, cancellations = 0;
  updater.checkForUpdates = async () => { checks++; updater.emit('update-available', { version: '0.2.0', releaseNotes: '<b>Changes</b>' }); };
  updater.downloadUpdate = async () => { downloads++; updater.emit('download-progress', { percent: 27 }); updater.emit('update-downloaded', { version: '0.2.0' }); };
  updater.quitAndInstall = () => { installs++; };
  const tasks = new Map(); let next = 0;
  const timers = { setTimeout(fn, ms) { const id = ++next; tasks.set(id, { fn, ms }); return id; }, setInterval(fn, ms) { const id = ++next; tasks.set(id, { fn, ms }); return id; }, clearTimeout(id) { tasks.delete(id); }, clearInterval(id) { tasks.delete(id); } };
  const service = await createUpdateService({ appVersion: '0.1.0', settingsPath, timers, loadUpdater: () => { loads++; return updater; }, prepareInstall: fn => fn(), cancelInstall: () => cancellations++, ...options });
  t.after(() => service.dispose());
  return { service, updater, tasks, settingsPath, count: () => ({ loads, checks, downloads, installs, cancellations }) };
}

test('all packaged desktop builds can check updates; source builds stay offline', async t => {
  assert.equal(updateAvailability({ packaged: true, release: false, platform: 'darwin' }), null);
  assert.equal(updateAvailability({ packaged: true, release: true, platform: 'linux', packageType: 'deb' }), null);
  assert.equal(updateAvailability({ packaged: true, release: false, platform: 'win32' }), null);
  assert.match(updateAvailability({ packaged: false, platform: 'darwin' }), /Install InjOffice/);
  assert.equal(updateAvailability({ packaged: true, release: true, platform: 'linux', packageType: 'AppImage' }), null);
  const f = await fixture(t, { unavailable: 'Local preview' });
  f.service.start(); await f.service.check(); await f.service.download(); await f.service.install();
  assert.equal(f.service.getState().status, 'disabled'); assert.equal(f.tasks.size, 0); assert.equal(f.count().loads, 0);
});

test('installer-based updates check automatically and never pretend a browser download is installed', async t => {
  const f = await fixture(t, {manualInstall: true});
  f.updater.downloadUpdate = async () => {};
  f.service.start();
  assert.equal(f.tasks.size, 2);
  await f.service.check();
  assert.equal(f.service.getState().manualInstall, true);
  await f.service.download();
  assert.equal(f.service.getState().status, 'available');
  assert.match(f.service.getState().message, /browser/);
  await f.service.install();
  assert.equal(f.count().installs, 0);
});

test('automatic checks are delayed, periodic, persisted, and never install on their own', async t => {
  const f = await fixture(t); f.service.start();
  assert.deepEqual([...f.tasks.values()].map(t => t.ms), [15000, 21600000]);
  await f.service.check();
  // The update is fetched in the background so the user is asked to restart, not to download;
  // installing still waits for that choice, so nothing restarts the app on its own.
  assert.deepEqual(f.count(), { loads: 1, checks: 1, downloads: 1, installs: 0, cancellations: 0 });
  assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false); assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.updater.disableWebInstaller, true);
  await f.service.setAutomaticUpdates(false);
  assert.equal(f.tasks.size, 0); assert.deepEqual(JSON.parse(await fs.readFile(f.settingsPath, 'utf8')), { version: 1, autoCheck: false });
  // A staged update suppresses further checks: there is nothing left to discover until it is
  // installed, so the count stays where it was.
  await f.service.check(); assert.equal(f.count().checks, 1, 'a staged update stops further checks');
  const quiet = await fixture(t, { settings: JSON.stringify({ version: 1, autoCheck: false }) });
  assert.equal((await quiet.service.check()).status, 'available', 'manual checking still works with automatic checks off');
  assert.equal(quiet.count().downloads, 0, 'and it does not fetch anything in the background');
  await assert.rejects(f.service.setAutomaticUpdates('false'), /Invalid/);
});

test('corrupt preferences fail closed, and preference writes remain ordered', async t => {
  const f = await fixture(t, { settings: '{broken' }); f.service.start();
  assert.equal(f.service.getState().autoCheck, false); assert.equal(f.tasks.size, 0);
  await Promise.all([f.service.setAutomaticUpdates(true), f.service.setAutomaticUpdates(false)]);
  assert.equal(f.service.getState().autoCheck, false); assert.equal(f.tasks.size, 0);
  assert.equal(JSON.parse(await fs.readFile(f.settingsPath, 'utf8')).autoCheck, false);
});

test('check and download calls serialize and a downloaded version cannot be replaced by a timer check', async t => {
  const f = await fixture(t); let finish;
  f.updater.checkForUpdates = () => new Promise(resolve => { finish = () => { f.updater.emit('update-available', { version: '0.2.0' }); resolve(); }; });
  const first = f.service.check();
  assert.equal((await f.service.check()).status, 'checking');
  assert.equal((await f.service.download()).status, 'checking');
  finish(); await first;
  await f.service.download(); assert.equal(f.service.getState().status, 'downloaded');
  await f.service.check(); assert.equal(f.service.getState().status, 'downloaded');
  await f.service.install(); assert.equal(f.service.getState().status, 'installing');
  await f.service.install(); assert.equal(f.count().installs, 1);
});

test('network and verification errors remain recoverable and redact server data', async t => {
  const f = await fixture(t);
  f.updater.checkForUpdates = async () => { throw new Error('secret URL/path/response'); };
  await f.service.check(); assert.equal(f.service.getState().status, 'error');
  assert.doesNotMatch(f.service.getState().message, /secret/);
  f.updater.checkForUpdates = async () => f.updater.emit('update-available', { version: '0.2.0' });
  // The background fetch runs inside the check, so a failing download surfaces from there.
  f.updater.downloadUpdate = async () => { f.updater.emit('error', new Error('signature failed')); throw Error('signature failed'); };
  await f.service.check(); assert.equal(f.service.getState().status, 'error');
  await f.service.install(); assert.equal(f.count().installs, 0);
});

test('workspace refusal never starts installer or cancels a separate normal close attempt', async t => {
  const f = await fixture(t, { prepareInstall: () => { throw Object.assign(Error('Save all files first.'), { code: 'UPDATE_WORKSPACE_UNSAFE' }); } });
  await f.service.check(); await f.service.download(); await f.service.install();
  assert.equal(f.service.getState().status, 'downloaded');
  assert.equal(f.service.getState().message, 'Save all files first.');
  assert.equal(f.count().installs, 0); assert.equal(f.count().cancellations, 0);
});

for (const synchronous of [true, false]) test(`${synchronous ? 'synchronous' : 'asynchronous'} Mac install error removes late quit callback before editing resumes`, async t => {
  const f = await fixture(t); let lateQuits = 0, permanentCalls = 0;
  f.updater.nativeUpdater.on('update-downloaded', () => permanentCalls++);
  f.updater.quitAndInstall = () => {
    f.updater.nativeUpdater.on('update-downloaded', () => lateQuits++);
    if (synchronous) f.updater.emit('error', Error('native install failed'));
  };
  await f.service.check(); await f.service.download(); await f.service.install();
  if (!synchronous) f.updater.emit('error', Error('native install failed'));
  assert.equal(f.service.getState().status, 'downloaded'); assert.ok(f.count().cancellations >= 1);
  f.updater.nativeUpdater.emit('update-downloaded');
  assert.equal(lateQuits, 0); assert.equal(permanentCalls, 1);
});


test('native updater selection follows installed package identity, including RPM on a Debian host', () => {
  const {NsisUpdater, AppImageUpdater, DebUpdater, RpmUpdater} = require('electron-updater');
  const app = {version: '0.1.0', name: 'InjOffice', isPackaged: true};
  for (const [platform, packageType, Type] of [
    ['win32', undefined, NsisUpdater], ['linux', 'AppImage', AppImageUpdater],
    ['linux', 'deb', DebUpdater], ['linux', 'rpm', RpmUpdater],
  ]) {
    assert.ok(loadReleaseUpdater(platform, {packageType, preview: true, app}) instanceof Type);
    assert.equal(updateAvailability({packaged: true, platform, packageType}), null);
  }
  assert.throws(() => loadReleaseUpdater('linux', {packageType: 'unknown', app}), /Unsupported/);
  assert.match(updateAvailability({packaged: true, platform: 'linux'}), /AppImage, DEB, or RPM/);
});

test('Linux authorization cancellation leaves the verified download ready and restores editing', async t => {
  const f = await fixture(t, {requiresElevation: true});
  f.updater.quitAndInstall = () => f.updater.emit('error', Error('authorization canceled'));
  await f.service.check(); await f.service.download(); await f.service.install();
  assert.equal(f.service.getState().manualInstall, false);
  assert.equal(f.service.getState().requiresElevation, true);
  assert.equal(f.service.getState().status, 'downloaded');
  assert.ok(f.count().cancellations > 0);
  let retried = false;
  f.updater.quitAndInstall = () => { retried = true; };
  await f.service.install();
  assert.equal(retried, true);
});

const {installLinuxPackage} = require('../electron/linux-package-updater.cjs');
test('Linux package installation uses literal argv and requires authorization', () => {
  const file = "/home/O'Neil/cache/update $(touch bad); name.deb";
  const calls = [];
  installLinuxPackage('deb', file, {uid: 1000,
    exists: binary => ['/usr/bin/apt-get', '/usr/bin/pkexec'].includes(binary),
    run: (...args) => { calls.push(args); return {status: 0}; }});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/usr/bin/pkexec');
  assert.deepEqual(calls[0][1], ['--disable-internal-agent', '/usr/bin/apt-get', 'install', '-y', file]);
  assert.equal(calls[0][2].shell, false);
});

test('failed authorization never falls through to a second installer or dependency repair', () => {
  let calls = 0;
  assert.throws(() => installLinuxPackage('deb', '/tmp/update.deb', {uid: 1000,
    exists: () => true, run: () => { calls++; return {status: 126}; }}), /authorization or package installation failed/);
  assert.equal(calls, 1);
});

test('RPM installs retain package manager verification and dependency checks', () => {
  for (const binary of ['/usr/bin/dnf', '/usr/bin/zypper', '/usr/bin/yum', '/usr/bin/rpm']) {
    let command;
    installLinuxPackage('rpm', '/tmp/update.rpm', {uid: 0, exists: item => item === binary,
      run: (file, args, options) => { command = {file, args, options}; return {status: 0}; }});
    assert.equal(command.file, binary);
    assert.equal(command.args.at(-1), '/tmp/update.rpm');
    assert.equal(command.options.shell, false);
    assert.doesNotMatch(command.args.join(' '), /nogpgcheck|unsigned|nodeps|replacefiles/);
  }
});

test('headless Linux authorization cannot wait on an invisible password prompt', () => {
  let args;
  installLinuxPackage('deb', '/tmp/update.deb', {uid: 1000,
    exists: binary => ['/usr/bin/apt-get', '/usr/bin/sudo'].includes(binary),
    run: (command, argv) => { assert.equal(command, '/usr/bin/sudo'); args = argv; return {status: 0}; }});
  assert.deepEqual(args.slice(0, 2), ['-n', '--']);
  assert.throws(() => installLinuxPackage('deb', '/tmp/update.deb', {uid: 1000,
    exists: binary => binary === '/usr/bin/apt-get', run: () => assert.fail('unexpected install')}), /authorization is unavailable/);
  assert.throws(() => installLinuxPackage('deb', 'relative.deb'), /Invalid update package/);
});

for (const [platform, packageType, extension] of [['win32', undefined, 'exe'], ['linux', 'deb', 'deb'], ['linux', 'rpm', 'rpm']]) {
  for (const corrupt of [false, true]) test(`${platform} ${extension} ${corrupt ? 'rejects a corrupt download' : 'downloads and verifies the update inside the app'}`, async t => {
    const {createServer} = require('node:http');
    const {createHash} = require('node:crypto');
    const {NodeHttpExecutor} = require('builder-util/out/nodeHttpExecutor');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'injoffice-native-download-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const payload = Buffer.from('verified installer fixture');
    const hash = createHash('sha512').update(corrupt ? 'different content' : payload).digest('base64');
    const server = createServer((request, response) => {
      if (new URL(request.url, 'http://localhost').pathname.endsWith('.yml')) response.end(`version: 0.2.0\nfiles:\n  - url: update.${extension}\n    sha512: ${hash}\n    size: ${payload.length}\n`);
      else { response.setHeader('Content-Length', payload.length); response.end(payload); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const config = path.join(directory, 'app-update.yml');
    await fs.writeFile(config, 'updaterCacheDirName: updater-cache\n');
    const app = {version: '0.1.0', name: 'InjOffice', isPackaged: true, whenReady: async () => {},
      userDataPath: directory, baseCachePath: directory, appUpdateConfigPath: config, onQuit() {}};
    const updater = loadReleaseUpdater(platform, {packageType, app});
    const errors = []; updater.on('error', error => errors.push(error.message));
    const {ElectronHttpExecutor} = require('electron-updater/out/electronHttpExecutor');
    updater.httpExecutor = new ElectronHttpExecutor();
    const transport = new NodeHttpExecutor();
    updater.httpExecutor.createRequest = transport.createRequest.bind(transport);
    updater.disableDifferentialDownload = true;
    // Test the real download/verification implementation against an isolated
    // fixture server; production discovery remains fixed to the InjOffice repo.
    updater.setFeedURL({provider: 'generic', url: `http://127.0.0.1:${server.address().port}`});
    const service = await createUpdateService({appVersion: app.version, settingsPath: path.join(directory, 'settings.json'),
      loadUpdater: () => updater, prepareInstall: () => assert.fail('downloads must not install')});
    t.after(() => service.dispose());
    // The check fetches what it finds, so the real download and its verification happen here.
    assert.equal((await service.check()).status, corrupt ? 'error' : 'downloaded', errors.join('\n'));
    if (corrupt) assert.match(errors.join('\n'), /checksum mismatch/i);
    if (!corrupt) assert.deepEqual(await fs.readFile(updater.downloadedUpdateHelper.file), payload);
    else assert.equal(updater.downloadedUpdateHelper.file, null);
  });
}

// The user should be asked whether to restart, not asked to fetch: a found update downloads
// itself. Targets whose "download" opens an installer in the browser are excluded, and so is a
// user who turned automatic checks off, because neither expects background traffic.
test('a found update downloads itself, except where the download is a deliberate act', async t => {
  const auto = await fixture(t);
  auto.service.start();
  await auto.service.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(auto.count().downloads, 1, 'the update was fetched without being asked for');
  assert.equal(auto.service.getState().status, 'downloaded', 'and is ready to install');

  const manual = await fixture(t, { manualInstall: true });
  manual.service.start();
  await manual.service.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manual.count().downloads, 0, 'a manual-install target does not open an installer on its own');
  assert.equal(manual.service.getState().status, 'available');

  const off = await fixture(t, { settings: JSON.stringify({ automatic: false }) });
  off.service.start();
  await off.service.check();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(off.count().downloads, 0, 'automatic checks off means no background download');
});

// Most people click "Later" and keep working, so a downloaded update also installs when the app
// next quits: only where that raises no prompt after the window is gone, and only for someone
// who left automatic updates on.
test('a downloaded update installs on quit only where asked, and follows the automatic preference', async t => {
  const f = await fixture(t, {installOnQuit: true});
  await f.service.check();
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  assert.equal(f.service.getState().installOnQuit, true);
  await f.service.setAutomaticUpdates(false);
  assert.equal(f.updater.autoInstallOnAppQuit, false, 'turning automatic updates off stops the quit install');
  assert.equal(f.service.getState().installOnQuit, false);
  await f.service.setAutomaticUpdates(true);
  assert.equal(f.updater.autoInstallOnAppQuit, true);
  assert.equal(f.count().installs, 0, 'nothing installs while the app is running');

  const packaged = await fixture(t);
  await packaged.service.check();
  assert.equal(packaged.updater.autoInstallOnAppQuit, false, 'off unless main asks (DEB/RPM would prompt after quit)');
  const manual = await fixture(t, {installOnQuit: true, manualInstall: true});
  await manual.service.check();
  assert.equal(manual.updater.autoInstallOnAppQuit, false, 'a browser-installer target has nothing to install');
  const quiet = await fixture(t, {installOnQuit: true, settings: JSON.stringify({version: 1, autoCheck: false})});
  await quiet.service.check();
  assert.equal(quiet.updater.autoInstallOnAppQuit, false, 'automatic updates off: the user decides');
  assert.equal(quiet.service.getState().installOnQuit, false);
});

// Pin the library behaviour the feature relies on, so an electron-updater upgrade that changes
// it fails here: the quit hook installs silently without relaunching, and only on a clean exit.
test('electron-updater installs a downloaded update silently on a clean quit and skips a failed one', () => {
  const {NsisUpdater} = require('electron-updater');
  const quits = [], installs = [];
  const app = {version: '0.1.0', name: 'InjOffice', isPackaged: true, appUpdateConfigPath: '/nonexistent', userDataPath: os.tmpdir(), baseCachePath: os.tmpdir(),
    whenReady: () => Promise.resolve(), relaunch() {}, quit() {}, onQuit(handler) { quits.push(handler); }};
  const make = enabled => {
    const updater = new NsisUpdater({provider: 'generic', url: 'https://updates.invalid'}, app);
    updater.logger = null;
    updater.doInstall = options => { installs.push(options); return true; };
    updater.downloadedUpdateHelper = {file: 'C:/cache/InjOffice-0.2.0-win-x64.exe', downloadedFileInfo: {isAdminRightsRequired: false}};
    updater.autoInstallOnAppQuit = enabled;
    updater.addQuitHandler();
    return updater;
  };
  make(false);
  assert.equal(quits.length, 0, 'disabled: no quit hook at all');
  make(true);
  assert.equal(quits.length, 1);
  quits[0](1);
  assert.equal(installs.length, 0, 'a crash or failed exit does not install');
  quits[0](0);
  assert.deepEqual(installs, [{isSilent: true, isForceRunAfter: false, isAdminRightsRequired: false}]);
});
