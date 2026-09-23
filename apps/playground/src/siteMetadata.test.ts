import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const PAGES = ['index.html', 'agents.html', 'playground.html'] as const

describe('public site metadata', () => {
  it('describes the playground and links it by its clean URL', () => {
    const html = page('playground.html')
    expect(html).toContain('<title>InjOffice playground — try the document engines in your browser</title>')
    expect(html).toContain('<link rel="canonical" href="https://injoffice.com/playground" />')
  })

  // The site root is the home page and the download page in one: it names both ways in, links
  // GitHub, shows the review step with a real operation, and carries the downloads, with a
  // scriptless fallback so a download works when the release API is unreachable.
  it('introduces the app and the libraries at the site root and offers the downloads there', () => {
    const html = page('index.html')
    expect(html).toContain('<title>InjOffice — Free open-source editor for Word, Excel, PowerPoint and PDF</title>')
    expect(html).toMatch(/<meta name="description" content="[^"]*macOS, Windows and Linux[^"]*"/)
    expect(html).toContain('<section id="download"')
    for (const asset of ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-amd64.deb', 'linux-x86_64.AppImage']) {
      expect(html).toContain(asset)
    }
    expect(html).toContain('https://github.com/injectinglabs/injoffice/releases')
    expect(html).toContain('id="primary-download" href="#download"')
    // The unsigned macOS builds warn on first launch; saying so is part of the page.
    expect(html).toContain('not signed or notarized')
    expect(html).toContain('The installer is signed')
    expect(html).toContain('class="github" href="https://github.com/injectinglabs/injoffice"')
    expect(html).toContain('xlsx.cell.set_value')
    expect(html).toContain('not Microsoft Office parity')
  })

  it('has no separate download page any more', () => {
    expect(existsSync(new URL('../download.html', import.meta.url))).toBe(false)
  })

  // Search and link previews: each page has a canonical clean URL, Open Graph and Twitter cards
  // with the shared 1200x630 image, and the home page describes the app as structured data.
  for (const name of PAGES) {
    it(`${name} is described for search engines and link previews`, () => {
      const html = page(name)
      expect(html).toMatch(/<html lang="en"/)
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/injoffice\.com\/[a-z]*" \/>/)
      for (const tag of ['og:title', 'og:description', 'og:url', 'og:site_name', 'og:type']) expect(html).toContain(`property="${tag}"`)
      expect(html).toContain('<meta property="og:image" content="https://injoffice.com/og/injoffice.png" />')
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
    })
  }

  it('describes InjOffice as free, open-source software in structured data', () => {
    const html = page('index.html')
    const json = html.slice(html.indexOf('<script type="application/ld+json">') + 35, html.indexOf('</script>', html.indexOf('application/ld+json')))
    const graph = JSON.parse(json)['@graph'] as Array<Record<string, unknown>>
    const app = graph.find(node => node['@type'] === 'SoftwareApplication')!
    expect(app).toMatchObject({ name: 'InjOffice', operatingSystem: 'macOS, Windows, Linux', license: 'https://www.apache.org/licenses/LICENSE-2.0' })
    expect(app.offers).toMatchObject({ price: '0' })
    expect(graph.find(node => node['@type'] === 'Organization')).toMatchObject({ sameAs: ['https://github.com/injectinglabs/injoffice'] })
    expect(existsSync(new URL('../public/og/injoffice.png', import.meta.url))).toBe(true)
  })

  // Site pages link each other by clean URL (/agents, /playground, /docs/...), never by .html.
  it('links site pages by clean URLs only', () => {
    for (const name of ['index.html', 'agents.html']) {
      const links = [...page(name).matchAll(/href="([^"]+)"/g)].map(match => match[1]!)
      const local = links.filter(href => href.startsWith('%BASE_URL%') || href.startsWith('/'))
      expect(local.filter(href => href.endsWith('.html')), name).toEqual([])
      expect(local).toContain('%BASE_URL%playground')
    }
  })

  it('publishes robots.txt and a sitemap of the clean URLs', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
    expect(robots).toContain('Sitemap: https://injoffice.com/sitemap.xml')
    const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8')
    for (const url of ['https://injoffice.com/', 'https://injoffice.com/agents', 'https://injoffice.com/playground']) {
      expect(sitemap).toContain(`<loc>${url}</loc>`)
    }
    expect(sitemap).not.toContain('.html')
  })

  // The project is free and open source: each page asks for a GitHub star, lets the visitor
  // close that ask for good, states the actual license, and ships one light theme.
  for (const name of ['index.html', 'agents.html']) {
    it(`${name} asks for a GitHub star, states the Apache-2.0 license, and has a single light theme`, () => {
      const html = page(name)
      expect(html).toContain('<p>Enjoying InjOffice? Rate us with a star on GitHub.</p>')
      expect(html).toContain('class="star-button" href="https://github.com/injectinglabs/injoffice"')
      expect(html).toContain("localStorage.setItem('injoffice-star-banner', 'dismissed')")
      expect(html).toContain('Apache-2.0')
      expect(html).not.toMatch(/MIT licen[cs]ed|MIT License/)
      expect(html).not.toMatch(/data-theme|theme-toggle|prefers-color-scheme: dark/)
      expect(html).toContain('color-scheme: light')
    })
  }
})
