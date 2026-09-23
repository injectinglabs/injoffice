import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public site metadata', () => {
  it('describes the document libraries and supported formats', () => {
    const html = readFileSync(new URL('../playground.html', import.meta.url), 'utf8')
    expect(html).toContain('<title>InjOffice — Open-source document editing libraries</title>')
    expect(html).toContain('<meta name="description" content="Open-source TypeScript and Go libraries for XLSX, DOCX, PPTX, and PDF editing, with agent APIs and browser-local processing." />')
  })

  // The site root is the home page: it names both ways in (the app and the libraries), links
  // to GitHub, and shows the review step with an operation the agent adapter really offers.
  it('introduces the app and the libraries at the site root', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('<title>InjOffice — Office files, edited by hand or by agent</title>')
    expect(html).toContain('href="%BASE_URL%download.html"')
    expect(html).toContain('href="#build"')
    expect(html).toContain('class="github" href="https://github.com/injectinglabs/injoffice"')
    expect(html).toContain('xlsx.cell.set_value')
    expect(html).toContain('not Microsoft Office parity')
    expect(html).toContain('playground.html')
  })

  // The download page has to name the product and the platforms before any script runs, and
  // it must keep a usable download link when the release API is unreachable, so the fallback
  // asset list stays in the markup.
  it('offers the desktop download, with a scriptless fallback', () => {
    const html = readFileSync(new URL('../download.html', import.meta.url), 'utf8')
    expect(html).toContain('<title>Download InjOffice — the open-source document editor</title>')
    expect(html).toMatch(/<meta name="description" content="[^"]*macOS, Windows or Linux[^"]*"/)
    for (const asset of ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-amd64.deb', 'linux-x86_64.AppImage']) {
      expect(html).toContain(asset)
    }
    expect(html).toContain('https://github.com/injectinglabs/injoffice/releases')
    expect(html).toContain('playground.html')
    // The unsigned macOS builds warn on first launch; saying so here is part of the page.
    expect(html).toContain('not signed or notarized')
    expect(html).toContain('The Windows\n              installer is signed')
  })

  // The project is free and open source: both pages ask for a GitHub star, let the visitor
  // close that ask for good, state the actual license, and ship one light theme.
  for (const page of ['index.html', 'download.html']) {
    it(`${page} asks for a GitHub star, states the Apache-2.0 license, and has a single light theme`, () => {
      const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8')
      expect(html).toContain('id="star-banner"')
      expect(html).toContain('class="star-button" href="https://github.com/injectinglabs/injoffice"')
      expect(html).toContain("localStorage.setItem('injoffice-star-banner', 'dismissed')")
      expect(html).toContain('Apache-2.0')
      expect(html).not.toMatch(/MIT licen[cs]ed|MIT License/)
      expect(html).not.toMatch(/data-theme|theme-toggle|prefers-color-scheme: dark/)
      expect(html).toContain('color-scheme: light')
    })
  }
})
