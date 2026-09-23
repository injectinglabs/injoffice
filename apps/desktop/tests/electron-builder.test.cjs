const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('electron-builder packages the Vite renderer and Electron host, not dist/', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'electron/main.cjs');
  assert.equal(pkg.scripts.build, 'vite build');
  assert.equal(pkg.scripts.start, 'electron .');
  assert.equal(pkg.scripts.dist, 'npm run build && electron-builder --config electron-builder.preview.cjs');
  assert.equal(pkg.devDependencies['electron-builder'], '^26.0.12');
  assert.equal(pkg.build.appId, 'com.injecting.injoffice');
  assert.equal(pkg.build.productName, 'InjOffice');
  assert.equal(pkg.build.directories.output, 'release');
  assert.equal(pkg.build.electronVersion, '43.7.0');
  assert.equal(pkg.build.publish, null);
  assert.deepEqual(pkg.build.files, ['electron/**/*.cjs', 'electron/icon.png', 'renderer/**/*', 'package.json']);
  assert.ok(!pkg.build.files.some(pattern => pattern.startsWith('dist/')));
  assert.equal(pkg.build.mac.icon, 'build/icons/icon.icns');
  assert.equal(pkg.build.win.icon, 'build/icons/icon.ico');
  // Let electron-builder derive the full Linux size set from the macOS ICNS.
  // A single PNG input installs only that one resolution.
  assert.equal(pkg.build.linux.icon, undefined);
  assert.equal(pkg.desktopName, 'injoffice.desktop');
  assert.equal(pkg.build.linux.syncDesktopName, true);
  assert.equal(pkg.homepage, 'https://injoffice.com');
  // electron-builder derives the executable from the package name (@injoffice/desktop -> "@injofficedesktop"), which AppImage refuses.
  assert.equal(pkg.build.linux.executableName, 'injoffice');
  // deb/rpm default to ${name}_${version}_${arch}, and the scoped name puts a slash in the file name; fpm cannot write it.
  assert.equal(pkg.build.linux.artifactName, '${productName}-${version}-linux-${arch}.${ext}');
  const extensions = pkg.build.fileAssociations.map(item => item.ext).sort();
  assert.deepEqual(extensions, ['docx', 'pdf', 'pptx', 'xlsx']);

  const release = fs.readFileSync(path.join(root, 'electron-builder.release.cjs'), 'utf8');
  assert.match(release, /require\('\.\/package\.json'\)/);
  assert.match(release, /tagNamePrefix:\s*'desktop-v'/);
  assert.match(release, /releaseType:\s*'draft'/);
  assert.match(release, /forceCodeSigning:\s*true/);
});

test('preview Mac signing seals the bundle without leaking into Developer ID releases', () => {
  const preview = require('../electron-builder.preview.cjs');
  const declared = process.env.INJOFFICE_MAC_UNSIGNED;
  delete process.env.INJOFFICE_MAC_UNSIGNED;
  delete require.cache[require.resolve('../electron-builder.release.cjs')];
  const release = require('../electron-builder.release.cjs');
  if (declared !== undefined) process.env.INJOFFICE_MAC_UNSIGNED = declared;
  assert.equal(preview.mac.identity, '-');
  assert.equal(preview.mac.hardenedRuntime, false);
  assert.equal(preview.mac.notarize, false);
  assert.equal(preview.publish.owner, 'injectinglabs');
  assert.equal(preview.publish.repo, 'injoffice');
  assert.equal(preview.publish.tagNamePrefix, 'desktop-preview-v');
  assert.equal(preview.extraMetadata?.injofficeRelease, undefined);
  assert.equal(release.mac.identity, undefined);
  assert.equal(release.mac.forceCodeSigning, true);
  assert.equal(release.mac.hardenedRuntime, true);
  assert.equal(release.mac.notarize, true);
});

// The installed application is called InjOffice on every platform; its version belongs in the
// app's update view, not in the name a system settings screen shows.
test('the installed name carries no version on any platform', () => {
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(build.productName, 'InjOffice');
  // electron-builder defaults this to "${productName} ${version}", which is what Windows shows
  // under Apps & features, so it has to be set explicitly.
  assert.equal(build.nsis.uninstallDisplayName, '${productName}');
  for (const [name, value] of Object.entries(build.nsis)) {
    assert.doesNotMatch(String(value), /\$\{version\}/, `nsis.${name} must not name the version`);
  }
  // Linux package identity and the macOS bundle name are separate from the version field; only
  // the artifact file names carry it.
  assert.equal(build.linux.executableName, 'injoffice');
  for (const section of ['linux', 'mac', 'win']) {
    for (const [name, value] of Object.entries(build[section] ?? {})) {
      if (name === 'artifactName') continue;
      assert.doesNotMatch(String(value), /\$\{version\}/, `${section}.${name} must not name the version`);
    }
  }
});

// INJOFFICE_MAC_UNSIGNED changes what the release config produces, so it must reach only the
// steps that act on it. Set for the whole job it also reaches the workspace tests, which are
// written against the signed configuration, and they fail on every platform.
test('the unsigned macOS declaration is scoped to the steps that use it', () => {
  const workflow = fs.readFileSync(path.resolve(root, '../../.github/workflows/desktop-release.yml'), 'utf8');
  const build = workflow.slice(workflow.indexOf('  build:'), workflow.indexOf('  draft:'));
  const jobEnv = build.slice(build.indexOf('    env:'), build.indexOf('    steps:'));
  assert.doesNotMatch(jobEnv, /INJOFFICE_MAC_UNSIGNED/, 'it must not be job-wide');
  const steps = build.slice(build.indexOf('    steps:'));
  assert.match(steps, /INJOFFICE_MAC_UNSIGNED/, 'the steps that act on it declare it');
  assert.equal((steps.match(/INJOFFICE_MAC_UNSIGNED/g) ?? []).length, 2, 'preflight and packaging, and nothing else');
});

// Whichever way macOS ships, the release proves something about the bundle: a signed run checks
// the Developer ID signature and the notarization ticket, an unsigned run checks the ad-hoc seal
// and that nothing pretends to be notarized. Neither may be silently absent.
test('each macOS signing mode has its own verification step', () => {
  const workflow = fs.readFileSync(path.resolve(root, '../../.github/workflows/desktop-release.yml'), 'utf8');
  assert.match(workflow, /if: runner\.os == 'macOS' && inputs\.mac_signing == 'signed'/);
  assert.match(workflow, /if: runner\.os == 'macOS' && inputs\.mac_signing == 'unsigned'/);
  assert.match(workflow, /stapler validate/, 'the signed path validates the notarization ticket');
  assert.match(workflow, /claims notarization in an unsigned release/, 'the unsigned path refuses a false claim');
});
