import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public site metadata', () => {
  it('describes the document libraries and supported formats', () => {
    const html = readFileSync(new URL('../playground.html', import.meta.url), 'utf8')
    expect(html).toContain('<title>InjOffice — Open-source document editing libraries</title>')
    expect(html).toContain('<meta name="description" content="Open-source TypeScript and Go libraries for XLSX, DOCX, PPTX, and PDF editing, with agent APIs and browser-local processing." />')
  })

  // The site root is the download page. It has to name the product and the platforms
  // before any script runs, and it must keep a usable download link when the release
  // API is unreachable, so the fallback asset list stays in the markup.
  it('offers the desktop download at the site root, with a scriptless fallback', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(html).toContain('<title>InjOffice — Download the open-source document editor</title>')
    expect(html).toMatch(/<meta name="description" content="[^"]*macOS, Windows or Linux[^"]*"/)
    for (const asset of ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-amd64.deb', 'linux-x86_64.AppImage']) {
      expect(html).toContain(asset)
    }
    expect(html).toContain('https://github.com/injectinglabs/injoffice/releases')
    expect(html).toContain('playground.html')
    // Unsigned builds warn on first launch; saying so here is part of the page.
    expect(html).toContain('not signed or notarized')
  })
})
