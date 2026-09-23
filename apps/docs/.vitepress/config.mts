import { defineConfig } from 'vitepress'
import { readFileSync } from 'node:fs'

// Canonical origin of the docs. The sitemap hostname and every page's canonical/og:url use it.
const SITE = 'https://injoffice.com/docs/'

const inventory = JSON.parse(readFileSync(new URL('../../../docs/api-reference.json', import.meta.url), 'utf8'))

export default defineConfig({
  title: 'InjOffice docs',
  titleTemplate: ':title | InjOffice docs',
  description: 'Build document workflows with InjOffice: TypeScript and Go guides, tested code examples, native file contracts, and model-neutral agent integration.',
  lang: 'en-US',
  // Published at injoffice.com/docs/. Pages are still emitted as .html files; the CDN serves
  // an extensionless /docs/x from /docs/x.html and /docs/x/ from index.html, so links stay clean.
  base: process.env.DOCS_BASE || '/docs/',
  appearance: false,
  srcExclude: ['README.md', 'tests/**', 'scripts/**'],
  cleanUrls: true,
  sitemap: { hostname: SITE },
  lastUpdated: false,
  head: [
    ['meta', { name: 'theme-color', content: '#ffffff' }],
    ['meta', { property: 'og:site_name', content: 'InjOffice' }],
    ['meta', { property: 'og:type', content: 'article' }],
    ['meta', { property: 'og:image', content: 'https://injoffice.com/og/injoffice.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    // The site's own font files, served from the domain root next to /docs/.
    ['link', { rel: 'stylesheet', href: '/fonts/fonts.css' }],
  ],
  markdown: { lineNumbers: false },
  // Per-page canonical and social tags, from the page's clean path under /docs/.
  transformHead({ pageData, siteData }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    const url = SITE + path
    const title = pageData.title ? `${pageData.title} | InjOffice docs` : siteData.title
    const description = pageData.description || siteData.description
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ]
  },
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'InjOffice / Docs',
    nav: [
      { text: 'Guides', link: '/getting-started/quickstart' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Home', link: 'https://injoffice.com/' },
      { text: 'Download', link: 'https://injoffice.com/#download' },
      { text: 'Agents', link: 'https://injoffice.com/agents' },
      { text: 'Try the demo', link: 'https://injoffice.com/playground' },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/injectinglabs/injoffice' }],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'On this page' },
    editLink: { pattern: 'https://github.com/injectinglabs/injoffice/edit/main/apps/docs/:path', text: 'Edit this page on GitHub' },
    sidebar: [
      { text: 'Start here', items: [
        { text: 'Introduction', link: '/' },
        { text: 'Quickstart', link: '/getting-started/quickstart' },
        { text: 'Choose your packages', link: '/getting-started/packages' },
        { text: 'Architecture & runtimes', link: '/getting-started/architecture' },
        { text: 'Support & limitations', link: '/getting-started/support' },
      ] },
      { text: 'Document guides', items: [
        { text: 'Spreadsheets / XLSX', link: '/guides/spreadsheets' },
        { text: 'Documents / DOCX', link: '/guides/documents' },
        { text: 'Presentations / PPTX', link: '/guides/presentations' },
        { text: 'PDFs', link: '/guides/pdf' },
        { text: 'Charts, pivots & formulas', link: '/guides/spreadsheet-tools' },
      ] },
      { text: 'Agents & integration', items: [
        { text: 'Your first agent workflow', link: '/agents/quickstart' },
        { text: 'Tool protocol & adapters', link: '/agents/integration' },
        { text: 'Approval & verification', link: '/agents/safety' },
        { text: 'Browser workers & assets', link: '/integration/browser' },
        { text: 'Go & optional HTTP server', link: '/integration/server' },
        { text: 'Collaboration & history', link: '/integration/collaboration' },
        { text: 'Security & production checklist', link: '/integration/security' },
        { text: 'Troubleshooting', link: '/integration/troubleshooting' },
      ] },
      { text: 'Reference', collapsed: true, items: [
        { text: 'Reference index', link: '/reference/' },
        ...inventory.packages.map((pkg: { name: string }) => ({ text: pkg.name.replace('@injoffice/', ''), link: `/reference/generated/packages/${pkg.name.replace('@injoffice/', '')}` })),
      ] },
      { text: 'Project', items: [
        { text: 'Examples & verification', link: '/examples/' },
        { text: 'Contributing', link: '/project/contributing' },
        { text: 'Maintaining these docs', link: '/project/documentation' },
      ] },
    ],
    footer: { message: 'Apache-2.0 project. Capability-scoped tools, not full Office compatibility.', copyright: 'InjOffice · Injecting Inc.' },
  },
})
