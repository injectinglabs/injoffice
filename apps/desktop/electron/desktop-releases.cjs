const semver = require('semver');

const REPOSITORY = 'https://github.com/injectinglabs/injoffice';
const STABLE = /^desktop-v(\d+\.\d+\.\d+)$/;
const PREVIEW = /^desktop-preview-v(\d+\.\d+\.\d+)(?:-r(\d+))?$/;

// Never select npm tags, drafts, arbitrary prereleases, or another repository.
async function findDesktopRelease(request, {preview = false, accept = () => true} = {}) {
  let selected = null;
  for (let page = 1; page <= 10; page++) {
    const releases = await request(new URL(`https://api.github.com/repos/injectinglabs/injoffice/releases?per_page=100&page=${page}`));
    if (!Array.isArray(releases)) throw new Error('Invalid desktop release list');
    for (const release of releases) {
      if (!release || release.draft || typeof release.tag_name !== 'string') continue;
      const stable = STABLE.exec(release.tag_name);
      const candidate = stable || (preview && PREVIEW.exec(release.tag_name));
      if (!candidate || !semver.valid(candidate[1]) || (stable && release.prerelease) || !accept(release, candidate[1])) continue;
      const revision = stable ? Number.MAX_SAFE_INTEGER : Number(candidate[2] || 0);
      if (!selected || semver.gt(candidate[1], selected.version) ||
          (candidate[1] === selected.version && revision > selected.revision)) {
        selected = {tag: release.tag_name, version: candidate[1], revision,
          name: typeof release.name === 'string' ? release.name.slice(0, 200) : release.tag_name,
          notes: typeof release.body === 'string' ? release.body.slice(0, 20000) : '',
          assets: Array.isArray(release.assets) ? release.assets : []};
      }
    }
    if (releases.length < 100) break;
  }
  return selected;
}

function installerName(release, platform, arch, format) {
  if (!['x64', 'arm64'].includes(arch)) return null;
  const suffix = platform === 'darwin' ? `mac-${arch}\\.dmg` :
    platform === 'linux' && ['deb', 'rpm'].includes(format) ?
      `linux-${arch === 'arm64' ? '(?:arm64|aarch64)' : '(?:x64|amd64|x86_64)'}\\.${format}` : null;
  if (!suffix) return null;
  const pattern = new RegExp(`^InjOffice-${release.version.replaceAll('.', '\\.')}\\-${suffix}$`);
  return release.assets.find(asset => asset.state === 'uploaded' && pattern.test(asset.name))?.name ?? null;
}

module.exports = {REPOSITORY, findDesktopRelease, installerName};
