// Shared behaviour for the content pages: the GitHub star banner and, on platform pages, the
// download box. The markup already carries working links to the last known release; this only
// refreshes them from the GitHub releases API when it answers.
const REPO = 'injectinglabs/injoffice'
const RELEASES = `https://github.com/${REPO}/releases`

// Each platform page lists its builds; a build resolves to the newest release that contains it.
const BUILDS = {
  macos: [
    { key: 'mac-arm64', match: /mac-arm64\.dmg$/ },
    { key: 'mac-x64', match: /mac-x64\.dmg$/ },
  ],
  windows: [
    { key: 'win-x64', match: /win-x64\.exe$/ },
  ],
  linux: [
    { key: 'linux-appimage', match: /linux-x86_64\.AppImage$/ },
    { key: 'linux-deb', match: /linux-amd64\.deb$/ },
    { key: 'linux-rpm', match: /linux-x86_64\.rpm$/ },
    { key: 'linux-arm64-appimage', match: /linux-arm64\.AppImage$/ },
    { key: 'linux-arm64-deb', match: /linux-arm64\.deb$/ },
    { key: 'linux-arm64-rpm', match: /linux-aarch64\.rpm$/ },
  ],
}

function starBanner() {
  const close = document.getElementById('star-close')
  close?.addEventListener('click', () => {
    document.getElementById('star-banner').hidden = true
    try { localStorage.setItem('injoffice-star-banner', 'dismissed') } catch {}
  })
  // The count appears only when it is large enough to help.
  fetch(`https://api.github.com/repos/${REPO}`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((repo) => {
      const stars = Number(repo?.stargazers_count)
      const count = document.getElementById('star-count')
      if (!count || !Number.isFinite(stars) || stars < 50) return
      count.textContent = stars >= 1000 ? `${(Math.round(stars / 100) / 10).toString().replace(/\.0$/, '')}k` : String(stars)
      count.setAttribute('aria-label', `${stars} stars`)
    })
    .catch(() => {})
}

function downloadBox() {
  const box = document.querySelector('.get[data-platform]')
  const builds = box && BUILDS[box.dataset.platform]
  if (!builds) return
  fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!Array.isArray(data)) return
      // Published desktop releases only: previews and drafts never reach a download page.
      const releases = data.filter((release) => !release.draft && !release.prerelease && /^desktop-v\d/.test(release.tag_name) && release.assets?.length)
      let newest = null
      for (const build of builds) {
        const link = box.querySelector(`[data-build="${build.key}"]`)
        if (!link) continue
        for (const release of releases) {
          const asset = release.assets.find((item) => build.match.test(item.name))
          if (!asset) continue
          link.href = `${RELEASES}/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`
          const version = release.tag_name.replace(/^desktop-v/, '')
          const tag = link.querySelector('[data-version]')
          if (tag) tag.textContent = version
          if (!newest && !build.key.includes('arm64-')) newest = version
          break
        }
      }
      const label = box.querySelector('[data-latest]')
      if (label && newest) label.textContent = newest
    })
    .catch(() => {})
}

starBanner()
downloadBox()
