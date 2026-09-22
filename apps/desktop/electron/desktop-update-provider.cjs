const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider')
const {findDesktopRelease} = require('./desktop-releases.cjs')

function providerError(message, code) {
  return Object.assign(new Error(message), { code })
}

// GitHub's /latest endpoint also returns npm releases in this monorepo.
// Keep electron-updater's download/signature implementation, but select only
// desktop tags. Signed installations remain stable-only; previews also see
// explicitly named desktop previews with a compatible native update feed.
class DesktopUpdateProvider extends GitHubProvider {
  constructor(options, updater, runtimeOptions) {
    super({ provider: 'github', owner: 'injectinglabs', repo: 'injoffice', channel: 'latest' }, updater, runtimeOptions)
    this.desktopRelease = null
    this.preview = options.preview === true
  }

  async getLatestTagName(cancellationToken) {
    this.desktopRelease = null
    this.desktopRelease = await findDesktopRelease(async url => {
      const raw = await this.httpRequest(url, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cancellationToken)
      try {
        const releases = JSON.parse(raw)
        if (!Array.isArray(releases)) throw new Error('Invalid release list')
        return releases
      } catch {
        throw providerError('GitHub returned invalid desktop release data.', 'ERR_UPDATER_INVALID_RELEASE_FEED')
      }
    }, {preview: this.preview, accept: release => !this.preview || release.assets?.some(asset => asset.name === `${this.channel}.yml` && asset.state === 'uploaded')})
    if (!this.desktopRelease) {
      throw providerError('No compatible InjOffice desktop release was found in the latest 1,000 GitHub releases.', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
    }
    return this.desktopRelease.tag
  }

  async getLatestVersion() {
    if (this.updater.allowPrerelease || (this.updater.channel && this.updater.channel !== 'latest')) {
      throw providerError('Unsupported desktop update channel.', 'ERR_UPDATER_UNSUPPORTED_CHANNEL')
    }
    this.desktopRelease = null
    const info = await super.getLatestVersion()
    const release = this.desktopRelease
    if (!release || info.tag !== release.tag || info.version !== release.version) {
      throw providerError('Desktop update metadata does not match its release tag.', 'ERR_UPDATER_INVALID_UPDATE_INFO')
    }
    // The Atom feed can omit an older desktop release amid frequent npm releases.
    // Always use the selected release's notes, never another feed entry's notes.
    return { ...info, releaseName: release.name, releaseNotes: release.notes }
  }
}

module.exports = { DesktopUpdateProvider, DesktopGitHubProvider: DesktopUpdateProvider }
