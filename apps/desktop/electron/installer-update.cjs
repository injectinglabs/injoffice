const {EventEmitter} = require('node:events');
const semver = require('semver');
const {REPOSITORY, findDesktopRelease, installerName} = require('./desktop-releases.cjs');

// Updates that must be completed by the OS installer still get automatic checks
// and an architecture-specific download. No renderer-provided URL is opened.
class InstallerUpdate extends EventEmitter {
  constructor({version, platform, arch, format, preview, request, openExternal}) {
    super();
    Object.assign(this, {version, platform, arch, format, preview, request, openExternal});
    this.release = null;
  }
  async checkForUpdates() {
    this.release = null;
    const release = await findDesktopRelease(this.request, {preview: this.preview,
      accept: (item, version) => Boolean(installerName({...item, version, assets: item.assets || []}, this.platform, this.arch, this.format))});
    if (!release || !semver.gt(release.version, this.version)) {
      this.emit('update-not-available');
      return;
    }
    this.release = release;
    this.emit('update-available', {version: release.version, releaseNotes: release.notes});
  }
  async downloadUpdate() {
    const release = this.release;
    if (!release || !semver.gt(release.version, this.version)) throw new Error('No newer installer selected');
    const name = installerName(release, this.platform, this.arch, this.format);
    if (!name) throw new Error('No compatible installer available');
    await this.openExternal(`${REPOSITORY}/releases/download/${release.tag}/${encodeURIComponent(name)}`);
  }
}

module.exports = {InstallerUpdate};
