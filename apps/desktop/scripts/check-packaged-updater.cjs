#!/usr/bin/env node
// Verify the updater dependencies inside every packaged application and that the
// update channel matches the build kind.
//
//   node check-packaged-updater.cjs <releaseDir>            unsigned preview
//   node check-packaged-updater.cjs <releaseDir> --release  signed desktop-v* draft
//
// Every packaged build checks for updates. The release marker restricts signed
// installations to stable releases; preview builds also discover desktop previews.
// Both configurations must carry the native feeds used by Windows and AppImage.
const fs = require('node:fs');
const path = require('node:path');
const { findPackagedApps, readAsar } = require('./packaged-app.cjs');

const desktopManifest = require('../package.json');
const UPDATER_MODULES = ['electron-updater', 'semver'];
const HOST_MODULES = ['electron/updates.cjs', 'electron/desktop-update-provider.cjs', 'electron/desktop-releases.cjs', 'electron/installer-update.cjs', 'electron/linux-package-updater.cjs'];
const FEED_BY_PLATFORM = { mac: 'latest-mac.yml', win: 'latest.yml', linux: 'latest-linux.yml' };

function yamlScalars(text, key) {
  return [...text.matchAll(new RegExp(`^\\s*-?\\s*${key}:\\s*(.+?)\\s*$`, 'gm'))].map(match => match[1].replace(/^['"]|['"]$/g, ''));
}

function checkPackagedUpdater(releaseDir, { release = false } = {}) {
  const problems = [];
  const notes = [];
  const apps = findPackagedApps(releaseDir);
  if (apps.length === 0) problems.push(`no unpacked application under ${releaseDir}`);
  for (const app of apps) {
    const label = app.name;
    if (!fs.existsSync(app.asar)) { problems.push(`${label}: ${app.asar} is missing`); continue; }
    const asar = readAsar(app.asar);
    try {
      const metadata = JSON.parse(asar.read('package.json').toString('utf8'));
      for (const name of UPDATER_MODULES) {
        const manifestPath = `node_modules/${name}/package.json`;
        if (!asar.has(manifestPath)) { problems.push(`${label}: ${manifestPath} is not packaged`); continue; }
        const packaged = JSON.parse(asar.read(manifestPath).toString('utf8'));
        const wanted = desktopManifest.dependencies[name];
        if (packaged.version !== wanted) problems.push(`${label}: packaged ${name}@${packaged.version}, apps/desktop/package.json wants ${wanted}`);
        if (metadata.dependencies?.[name] !== wanted) problems.push(`${label}: packaged package.json does not depend on ${name}@${wanted}`);
      }
      for (const host of HOST_MODULES) if (!asar.has(host)) problems.push(`${label}: ${host} is not packaged`);
      const flagged = metadata.injofficeRelease === true;
      const feedConfig = path.join(app.resources, 'app-update.yml');
      const hasFeedConfig = fs.existsSync(feedConfig);
      if (release && !flagged) problems.push(`${label}: package.json lacks injofficeRelease: true (electron-builder.release.cjs extraMetadata)`);
      if (!release && flagged) problems.push(`${label}: unsigned preview must not carry injofficeRelease: true`);
      if (!hasFeedConfig) problems.push(`${label}: ${feedConfig} is missing; the updater has no feed`);
      else {
        const feed = fs.readFileSync(feedConfig, 'utf8');
        for (const [key, value] of [['provider', 'github'], ['owner', 'injectinglabs'], ['repo', 'injoffice']]) {
          if (!yamlScalars(feed, key).includes(value)) problems.push(`${label}: app-update.yml ${key} is not ${value}`);
        }
      }
      const feedName = app.platform === 'linux' && app.arch !== 'x64' ? `latest-linux-${app.arch}.yml` : FEED_BY_PLATFORM[app.platform];
      const feedFile = path.join(releaseDir, feedName);
      if (!fs.existsSync(feedFile)) problems.push(`${label}: ${feedFile} was not produced`);
      else {
        const feed = fs.readFileSync(feedFile, 'utf8');
        const version = yamlScalars(feed, 'version')[0];
        if (version !== metadata.version) problems.push(`${label}: ${path.basename(feedFile)} version ${version} != packaged ${metadata.version}`);
        for (const url of yamlScalars(feed, 'url')) if (!fs.existsSync(path.join(releaseDir, url))) problems.push(`${label}: ${path.basename(feedFile)} references missing ${url}`);
      }
      notes.push(`${label}: ${release ? 'stable release' : 'preview'} update checks enabled; updater feed ${feedName} present`);
    } catch (error) {
      problems.push(`${label}: ${error.message}`);
    } finally { asar.close(); }
  }
  return { apps, problems, notes };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const release = args.includes('--release');
  const releaseDir = path.resolve(args.find(arg => !arg.startsWith('--')) ?? path.join(__dirname, '../release'));
  const { problems, notes } = checkPackagedUpdater(releaseDir, { release });
  for (const note of notes) console.log(note);
  if (problems.length > 0) {
    console.error(`Packaged updater check failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}

module.exports = { checkPackagedUpdater, UPDATER_MODULES, HOST_MODULES, FEED_BY_PLATFORM };
