const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DesktopUpdateProvider } = require('../electron/desktop-update-provider.cjs')

const feed = '<feed><entry><title>Npm release</title><link href="https://github.com/injectinglabs/injoffice/releases/tag/v99.0.0"/><content>Wrong release notes</content></entry></feed>'
const release = (version, extra = {}) => ({ tag_name: `desktop-v${version}`, draft: false, prerelease: false, name: 'Desktop release', body: 'Correct desktop notes', ...extra })
function setup(pages, version = '0.3.0', options = {}) {
  const calls = []
  const updater = { allowPrerelease: false, currentVersion: { raw: '0.1.0' }, fullChangelog: false }
  const executor = { async request(options, token) {
    calls.push({ options, token })
    if (options.path.endsWith('.atom')) return feed
    if (options.hostname === 'api.github.com') {
      const page = Number(new URL(`https://${options.hostname}${options.path}`).searchParams.get('page'))
      return JSON.stringify(pages[page - 1] || [])
    }
    return `version: ${version}\nfiles:\n  - url: InjOffice.zip\n    sha512: test\n    size: 123\n`
  } }
  const provider = new DesktopUpdateProvider({ owner: 'untrusted', repo: 'wrong', token: 'ignored', ...options }, updater, { executor, platform: 'darwin' })
  return { provider, updater, calls }
}

test('ignores npm, malformed tags, drafts and prereleases; chooses greatest semantic version', async () => {
  const { provider } = setup([[release('0.3.0'), release('0.2.0'), release('99.0.0', { draft: true }), release('98.0.0', { prerelease: true }), release('0.4.0-beta.1'), release('01.0.0'), { tag_name: 'v100.0.0' }]])
  assert.equal(await provider.getLatestTagName({}), 'desktop-v0.3.0')
})

test('preview builds select explicit desktop previews with native feeds, ignoring npm and incomplete releases', async () => {
  const preview = (version, extra = {}) => ({tag_name: `desktop-preview-v${version}`, prerelease: true, assets: [{name: 'latest-mac.yml', state: 'uploaded'}], ...extra})
  const {provider} = setup([[preview('0.2.0-r2'), preview('0.2.0-r4'), preview('9.0.0', {assets: []}), preview('10.0.0', {draft: true}), {tag_name: 'v99.0.0'}]], '0.2.0', {preview: true})
  const info = await provider.getLatestVersion()
  assert.equal(info.tag, 'desktop-preview-v0.2.0-r4')
  assert.equal(info.version, '0.2.0')
})

const {InstallerUpdate} = require('../electron/installer-update.cjs')
const {findDesktopRelease} = require('../electron/desktop-releases.cjs')
test('stable releases win equal versions; previews never enter signed installations', async () => {
  const items = [release('0.2.0'), {tag_name: 'desktop-preview-v0.2.0-r99', prerelease: true}, {tag_name: 'desktop-preview-v0.3.0', prerelease: true}]
  assert.equal((await findDesktopRelease(async () => items)).version, '0.2.0')
  assert.equal((await findDesktopRelease(async () => items.slice(0, 2), {preview: true})).tag, 'desktop-v0.2.0')
})

for (const [platform, arch, format, suffix] of [['linux', 'arm64', 'deb', 'linux-arm64.deb'], ['linux', 'x64', 'deb', 'linux-amd64.deb'], ['linux', 'arm64', 'rpm', 'linux-aarch64.rpm'], ['darwin', 'arm64', undefined, 'mac-arm64.dmg'], ['darwin', 'x64', undefined, 'mac-x64.dmg']]) {
  test(`installer update selects ${suffix} and only opens the official asset URL`, async () => {
    const name = `InjOffice-0.1.11-${suffix}`
    const opened = [], events = []
    const updater = new InstallerUpdate({version: '0.1.0', platform, arch, format, preview: true,
      request: async () => [{tag_name: 'desktop-preview-v0.1.11', prerelease: true,
        assets: [{name: 'InjOffice-0.1.11-linux-x64.deb', state: 'uploaded'}, {name, state: 'uploaded', browser_download_url: 'https://untrusted.invalid/payload'}]}],
      openExternal: async url => opened.push(url)})
    updater.on('update-available', value => events.push(value))
    await updater.checkForUpdates()
    assert.equal(events[0].version, '0.1.11')
    assert.equal(opened.length, 0, 'checking never starts a download')
    await updater.downloadUpdate()
    // The x64 canonical filename wins when both Debian aliases exist.
    const expected = platform === 'linux' && arch === 'x64' ? 'InjOffice-0.1.11-linux-x64.deb' : name
    assert.deepEqual(opened, [`https://github.com/injectinglabs/injoffice/releases/download/desktop-preview-v0.1.11/${expected}`])
  })
}

test('installer updates never offer the same version, a downgrade, or the wrong architecture', async () => {
  let items = [], available = 0, current = 0
  const updater = new InstallerUpdate({version: '0.1.0', platform: 'linux', arch: 'arm64', format: 'deb', preview: true,
    request: async () => items, openExternal: async () => assert.fail('unexpected browser launch')})
  updater.on('update-available', () => available++)
  updater.on('update-not-available', () => current++)
  for (const version of ['0.1.0', '0.0.9']) {
    items = [{tag_name: `desktop-preview-v${version}`, assets: [{name: `InjOffice-${version}-linux-arm64.deb`, state: 'uploaded'}]}]
    await updater.checkForUpdates()
  }
  items = [{tag_name: 'desktop-preview-v9.0.0', assets: [{name: 'InjOffice-9.0.0-linux-x64.deb', state: 'uploaded'}]}]
  await updater.checkForUpdates()
  assert.equal(available, 0)
  assert.equal(current, 3)
  await assert.rejects(updater.downloadUpdate(), /No newer/)
})

test('paginates with cancellation token and cannot configure a different repository', async () => {
  const { provider, calls } = setup([Array.from({ length: 100 }, () => ({ tag_name: 'v1.0.0' })), [release('0.3.0')]])
  const token = { test: true }
  assert.equal(await provider.getLatestTagName(token), 'desktop-v0.3.0')
  assert.equal(calls.length, 2)
  for (const { options, token: actual } of calls) {
    assert.equal(options.hostname, 'api.github.com')
    assert.match(options.path, /^\/repos\/injectinglabs\/injoffice\/releases\?per_page=100&page=/)
    assert.equal(actual, token)
    assert.equal(options.headers.Authorization, undefined)
  }
})

test('limits discovery to ten pages', async () => {
  const pages = Array.from({ length: 11 }, () => Array.from({ length: 100 }, () => release('0.3.0')))
  const { provider, calls } = setup(pages)
  await provider.getLatestTagName({})
  assert.equal(calls.length, 10)
})

test('reports absence of stable desktop releases', async () => {
  const { provider } = setup([[{ tag_name: 'v1.0.0' }]])
  await assert.rejects(provider.getLatestTagName({}), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' })
})

test('downloads metadata from selected desktop tag and uses its notes even when missing in feed', async () => {
  const { provider, calls } = setup([[release('0.3.0')]])
  const info = await provider.getLatestVersion()
  assert.equal(info.tag, 'desktop-v0.3.0')
  assert.equal(info.releaseNotes, 'Correct desktop notes')
  assert.equal(info.releaseName, 'Desktop release')
  assert.match(calls.at(-1).options.path, /\/desktop-v0\.3\.0\/latest-mac.yml$/)
  const [file] = provider.resolveFiles(info)
  assert.equal(file.url.href, 'https://github.com/injectinglabs/injoffice/releases/download/desktop-v0.3.0/InjOffice.zip')
})

test('rejects metadata belonging to another version', async () => {
  const { provider } = setup([[release('0.3.0')]], '99.0.0')
  await assert.rejects(provider.getLatestVersion(), { code: 'ERR_UPDATER_INVALID_UPDATE_INFO' })
})

test('refuses prerelease lookup and custom channels instead of selecting npm releases', async () => {
  const { provider, updater, calls } = setup([])
  updater.allowPrerelease = true
  await assert.rejects(provider.getLatestVersion(), { code: 'ERR_UPDATER_UNSUPPORTED_CHANNEL' })
  updater.allowPrerelease = false
  updater.channel = 'beta'
  await assert.rejects(provider.getLatestVersion(), { code: 'ERR_UPDATER_UNSUPPORTED_CHANNEL' })
  assert.equal(calls.length, 0)
})

test('bounds selected release text', async () => {
  const { provider } = setup([[release('0.3.0', { body: 'a'.repeat(30000), name: 'b'.repeat(300) })]])
  const info = await provider.getLatestVersion()
  assert.equal(info.releaseNotes.length, 20000)
  assert.equal(info.releaseName.length, 200)
})

test('invalid API responses and network errors fail closed', async () => {
  const { provider } = setup([])
  provider.httpRequest = async () => '{bad'
  await assert.rejects(provider.getLatestTagName({}), { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' })
  provider.httpRequest = async () => '{"message":"rate limited"}'
  await assert.rejects(provider.getLatestTagName({}), { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' })
  provider.httpRequest = async () => { throw new Error('cancelled') }
  await assert.rejects(provider.getLatestTagName({}), /cancelled/)
})
