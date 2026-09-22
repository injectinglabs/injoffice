// Inspect actual DEB/RPM payloads before publishing Linux installers.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const release = path.resolve(process.argv[2] || 'apps/desktop/release');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'injoffice-linux-metadata-'));
const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
try {
  for (const extension of ['deb', 'rpm']) {
    const matches = fs.readdirSync(release).filter(name => name.endsWith(`.${extension}`));
    assert.equal(matches.length, 1, `expected one ${extension} package`);
    const file = path.join(release, matches[0]);
    const root = path.join(temporary, extension);
    fs.mkdirSync(root);
    if (extension === 'deb') {
      run('dpkg-deb', ['--extract', file, root]);
      assert.equal(run('dpkg-deb', ['--field', file, 'Homepage']).trim(), 'https://injoffice.com');
      assert.equal(run('dpkg-deb', ['--field', file, 'Vendor']).trim(), 'Injecting Inc.');
      assert.equal(run('dpkg-deb', ['--field', file, 'Architecture']).trim(), process.arch === 'arm64' ? 'arm64' : 'amd64');
    } else {
      run('bsdtar', ['-xf', file, '-C', root]);
      assert.equal(run('rpm', ['-qp', '--queryformat', '%{URL}', file]).trim(), 'https://injoffice.com');
      assert.equal(run('rpm', ['-qp', '--queryformat', '%{VENDOR}', file]).trim(), 'Injecting Inc.');
      assert.equal(run('rpm', ['-qp', '--queryformat', '%{ARCH}', file]).trim(), process.arch === 'arm64' ? 'aarch64' : 'x86_64');
    }
    assert.equal(fs.readFileSync(path.join(root, 'opt/InjOffice/resources/package-type'), 'utf8').trim(), extension,
      'installed package must select its matching native updater');
    const desktop = path.join(root, 'usr/share/applications/injoffice.desktop');
    run('desktop-file-validate', [desktop]);
    const launcher = fs.readFileSync(desktop, 'utf8');
    assert.match(launcher, /^Name=InjOffice$/m);
    assert.match(launcher, /^Icon=injoffice$/m);
    assert.match(launcher, /^StartupWMClass=injoffice$/m);
    for (const size of [48, 64, 128, 256]) {
      const icon = fs.readFileSync(path.join(root, `usr/share/icons/hicolor/${size}x${size}/apps/injoffice.png`));
      assert.equal(icon.subarray(1, 4).toString(), 'PNG');
      assert.equal(icon.readUInt32BE(16), size);
      assert.equal(icon.readUInt32BE(20), size);
    }
    const metainfo = path.join(root, 'usr/share/metainfo/com.injecting.injoffice.metainfo.xml');
    run('appstreamcli', ['validate', '--no-net', metainfo]);
    assert.equal(fs.readFileSync(metainfo, 'utf8'), fs.readFileSync(path.join(__dirname, '../build/linux/com.injecting.injoffice.metainfo.xml'), 'utf8'));
    console.log(`${matches[0]}: website, vendor, launcher, icon sizes and AppStream metadata verified`);
  }
} finally {
  fs.rmSync(temporary, {recursive: true, force: true});
}
