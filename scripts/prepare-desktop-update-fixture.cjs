// CI-only: turn a build artifact into an older-version baseline, while retaining
// the updater implementation under review. Never publish these modified bytes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const asar = require('@electron/asar');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'fixture preparation is restricted to disposable CI runners');
assert.ok(['linux', 'win32'].includes(process.platform));
async function patchArchive(resources) {
  const archive = path.join(resources, 'app.asar');
  const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'injoffice-upgrade-fixture-'));
  try {
    asar.extractAll(archive, unpacked);
    const file = path.join(unpacked, 'package.json');
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(metadata.name, '@injoffice/desktop');
    metadata.version = '0.0.0';
    fs.writeFileSync(file, JSON.stringify(metadata));
    await asar.createPackage(unpacked, archive + '.fixture');
    fs.renameSync(archive + '.fixture', archive);
    asar.uncache(archive);
    assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).version, '0.0.0');
  } finally { fs.rmSync(unpacked, {recursive: true, force: true}); }
}
(async () => {
  const [format, input, output] = process.argv.slice(2);
  if (format === 'deb') {
    assert.equal(process.platform, 'linux');
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'injoffice-upgrade-deb-'));
    try {
      execFileSync('dpkg-deb', ['-R', input, staging]);
      const resources = path.join(staging, 'opt/InjOffice/resources');
      await patchArchive(resources);
      const control = path.join(staging, 'DEBIAN/control');
      fs.writeFileSync(control, fs.readFileSync(control, 'utf8').replace(/^Version: .+$/m, 'Version: 0.0.0'));
      const sums = path.join(staging, 'DEBIAN/md5sums');
      if (fs.existsSync(sums)) {
        const digest = createHash('md5').update(fs.readFileSync(path.join(resources, 'app.asar'))).digest('hex');
        fs.writeFileSync(sums, fs.readFileSync(sums, 'utf8').replace(/^[a-f0-9]+(\s+opt\/InjOffice\/resources\/app\.asar)$/m, `${digest}$1`));
      }
      execFileSync('dpkg-deb', ['--build', '--root-owner-group', staging, output], {stdio: 'inherit'});
    } finally { fs.rmSync(staging, {recursive: true, force: true}); }
  } else if (format === 'windows') {
    assert.equal(process.platform, 'win32');
    await patchArchive(input);
  } else throw new Error('expected deb <input> <output> or windows <resources>');
  console.log('Prepared CI-only version 0.0.0 baseline with the reviewed updater.');
})().catch(error => {console.error(error); process.exitCode = 1;});
