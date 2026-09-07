import { useEffect, useState } from 'react'
import { currentColorScheme, persistColorScheme, type ColorScheme } from '../colorScheme'
import './tokens.css'
import './components.css'
import {
  DsBadge,
  DsButton,
  DsCallout,
  DsField,
  DsFileObject,
  DsInput,
  DsMark,
  DsPresence,
  DsProof,
  DsSelect,
  DsStatus,
  DsTabs,
  DsTextarea,
} from './primitives'

const SECTIONS = [
  { id: 'intent', label: 'Intent' },
  { id: 'color', label: 'Color' },
  { id: 'type', label: 'Type' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'status', label: 'Status' },
  { id: 'file', label: 'File object' },
  { id: 'proof', label: 'Proof sequence' },
  { id: 'data', label: 'Tables and code' },
  { id: 'nav', label: 'Navigation' },
  { id: 'chrome', label: 'Workbench chrome' },
  { id: 'empty', label: 'Empty and refused' },
  { id: 'presence', label: 'Presence' },
]

const PROOF = [
  { title: 'Extract', detail: 'sha256:bdf753af2b…612f0d' },
  { title: 'Guard', detail: 'cell.set_value Data!A1' },
  { title: 'Apply', detail: 'Go engine in a browser Worker' },
  { title: 'Verify', detail: 'value confirmed, revision advanced' },
]

const SWATCHES = [
  ['Vellum', 'var(--ds-vellum)', 'Page ground. Green-cast ledger paper, not cream and not app-gray.'],
  ['Sheet', 'var(--ds-sheet)', 'Raised file surface.'],
  ['Ink', 'var(--ds-ink)', 'Primary text.'],
  ['Rule', 'var(--ds-rule)', 'Ledger lines and control borders.'],
  ['Applied', 'var(--ds-applied)', 'The only success color: a change landed.'],
  ['Refused', 'var(--ds-refused)', 'Fail-closed. Original bytes unchanged.'],
  ['Steel', 'var(--ds-steel)', 'Interactive chrome. Not a marketing blue.'],
]

function parseSection(hash = location.hash): string | null {
  return new URLSearchParams(hash.split('?')[1] ?? '').get('section')
}

export default function GalleryPage() {
  const [scheme, setScheme] = useState<ColorScheme>(() => currentColorScheme())
  const [view, setView] = useState('native')
  const [stamp, setStamp] = useState<'idle' | 'applied' | 'refused'>('idle')
  const [section, setSection] = useState<string | null>(() => parseSection())

  useEffect(() => {
    const sync = () => setSection(parseSection())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (!section) return
    document.getElementById(section)?.scrollIntoView({ block: 'start' })
  }, [section])

  const setTheme = (next: ColorScheme) => {
    persistColorScheme(next)
    setScheme(next)
  }

  return (
    <div className="ds">
      <header className="ds-folio">
        <a className="ds-brand" href="#/design-system">
          <DsMark />
          <span>
            <strong>InjOffice</strong>
            <small>Proposed design system</small>
          </span>
        </a>
        <div className="ds-folio-meta">
          <div className="ds-tabs" role="group" aria-label="Color scheme">
            <button type="button" aria-selected={scheme === 'light'} onClick={() => setTheme('light')}>Light</button>
            <button type="button" aria-selected={scheme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
          </div>
          <a className="ds-btn ds-btn--ghost" href="#/overview">Current demo</a>
        </div>
      </header>

      <div className="ds-gallery">
        <main className="ds-gallery-main">
          <p className="ds-kicker">
            <DsBadge>Proposal</DsBadge>
            <DsBadge tone="steel">Does not restyle the live demo</DsBadge>
          </p>
          <h1 className="ds-type-display">A proof table for original Office files.</h1>
          <p className="ds-type-body">
            The current playground looks like a dark admin kit with rounded controls. This system treats the file as the object: ledger paper, a hard sheet shadow, and two loud colors — applied or refused. Review this gallery. After you approve it, we rebuild the demo on these parts.
          </p>

          <section id="intent">
            <h2>Intent</h2>
            <p>
              InjOffice stamps one bounded change through original OPC bytes. The visual language comes from a bindery table, not a SaaS dashboard: square corners, a 40px manuscript gutter, hashes set in mono, and almost no drop shadows.
            </p>
            <ul>
              <li>The file is the hero. Chrome recedes to a folio line.</li>
              <li>Applied and refused are the only saturated colors.</li>
              <li>Type hierarchy does the grouping. Cards are rare.</li>
              <li>Numbered steps exist only for extract → guard → apply → verify.</li>
            </ul>
          </section>

          <section id="color">
            <h2>Color</h2>
            <p>Six working inks. Light and dark share names so a proof never changes meaning.</p>
            <div className="ds-stack">
              {SWATCHES.map(([name, fill, note]) => (
                <div className="ds-swatch" key={name}>
                  <i style={{ background: fill }} />
                  <div>
                    <strong>{name}</strong>
                    <div className="ds-hash">{note}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section id="type">
            <h2>Type</h2>
            <p>
              Bricolage Grotesque for UI and titles — a workshop face, not Inter or Source Sans. IBM Plex Mono for revisions, A1, and XML. Body stays under 38em.
            </p>
            <p className="ds-type-display">Edit the original package.</p>
            <p className="ds-type-body">Inspect a real workbook, bind one typed change to that revision, patch only the requested XML, and reopen the exact returned bytes.</p>
            <p className="ds-hash">sha256:bdf753af2b…612f0d</p>
          </section>

          <section id="buttons">
            <h2>Buttons</h2>
            <p>Apply is green because it writes bytes. Refuse is the fail-closed path. Steel is navigation, not a save.</p>
            <div className="ds-row">
              <DsButton variant="apply" onClick={() => setStamp('applied')}>Apply change</DsButton>
              <DsButton variant="refuse" onClick={() => setStamp('refused')}>Refuse</DsButton>
              <DsButton variant="steel">Open workbook</DsButton>
              <DsButton>Secondary</DsButton>
              <DsButton variant="ghost">Ghost</DsButton>
              <DsButton disabled>Disabled</DsButton>
            </div>
            {stamp === 'applied' ? <DsBadge tone="applied">Applied · revision advanced</DsBadge> : null}
            {stamp === 'refused' ? <DsBadge tone="refused">Refused · original bytes kept</DsBadge> : null}
          </section>

          <section id="inputs">
            <h2>Inputs</h2>
            <p>Same height as buttons. Labels sit above, never inside.</p>
            <div className="ds-field-row">
              <DsField label="Cell">
                <DsInput defaultValue="Data!A1" />
              </DsField>
              <DsField label="Value">
                <DsInput type="number" defaultValue={42} />
              </DsField>
              <DsField label="View">
                <DsSelect defaultValue="native">
                  <option value="editor">Editor</option>
                  <option value="native">Native</option>
                  <option value="tools">Tools</option>
                </DsSelect>
              </DsField>
            </div>
            <DsField label="Mutation batch">
              <DsTextarea defaultValue={'{\n  "protocol": "injoffice.xlsx.mutations",\n  "version": 1\n}'} rows={5} spellCheck={false} />
            </DsField>
          </section>

          <section id="status">
            <h2>Status</h2>
            <p>Badges are mono so they sit next to hashes. Runtime is a dot, not a pill rainbow.</p>
            <div className="ds-row">
              <DsBadge>@injoffice/xlsx-wasm</DsBadge>
              <DsBadge tone="steel">Browser</DsBadge>
              <DsBadge tone="applied">Applied</DsBadge>
              <DsBadge tone="refused">Refused</DsBadge>
              <DsStatus state="live">Browser engines ready</DsStatus>
              <DsStatus state="down">Sidecar offline</DsStatus>
            </div>
            <div className="ds-stack">
              <DsCallout tone="note" title="Original bytes stay authoritative">
                Univer is an optional grid. Saving always goes through Go apply into the original archive.
              </DsCallout>
              <DsCallout tone="applied" title="Change landed">
                Data!A1 is 42. Package SHA advanced. Everything outside the edit is byte-identical.
              </DsCallout>
              <DsCallout tone="refused" title="Apply refused">
                STALE_REVISION. The original bytes were not replaced.
              </DsCallout>
            </div>
          </section>

          <section id="file">
            <h2>File object</h2>
            <p>The workbook sits on the table as a sheet with a hard offset, not a floating card.</p>
            <DsFileObject name="launch-readiness-plan.xlsx" detail="Bundled fixture · 24 KiB" runtime="Browser-local">
              <p className="ds-hash">sha256:bdf753af2b…612f0d</p>
            </DsFileObject>
          </section>

          <section id="proof">
            <h2>Proof sequence</h2>
            <p>This is an actual sequence, so it is numbered. Other lists are not.</p>
            <DsFileObject name="Native XLSX proof" detail="Extract, guard, apply, verify" runtime="Worker">
              <DsProof steps={PROOF} />
            </DsFileObject>
          </section>

          <section id="data">
            <h2>Tables and code</h2>
            <p>Grid rules, not zebra stripes. Code is a dark slab with a hard border.</p>
            <table className="ds-table">
              <thead>
                <tr><th>Ref</th><th>Kind</th><th>Value</th></tr>
              </thead>
              <tbody>
                <tr><td><code>A1</code></td><td>string</td><td>Item</td></tr>
                <tr><td><code>B2</code></td><td>number</td><td>42</td></tr>
                <tr><td><code>C2</code></td><td>formula</td><td><code>=COUNTA(A2:A3)</code></td></tr>
              </tbody>
            </table>
            <pre className="ds-code">{`const workbook = await client.extract(original)
const saved = await client.apply(original, workbook, transaction)`}</pre>
          </section>

          <section id="nav">
            <h2>Navigation</h2>
            <p>Current page is a sheet, not an inverted navy rail. The applied tick marks the live surface.</p>
            <DsTabs
              label="Sheets view"
              value={view}
              onChange={setView}
              options={[
                { id: 'editor', label: 'Editor' },
                { id: 'native', label: 'Native' },
                { id: 'tools', label: 'Tools' },
              ]}
            />
            <nav className="ds-nav" aria-label="Example tools" style={{ maxWidth: 280, marginTop: 16, border: '1px solid var(--ds-rule)', background: 'var(--ds-vellum)' }}>
              <a href="#/design-system?section=nav" aria-current="page"><i /><span><strong>Native XLSX</strong><small>@injoffice/xlsx-wasm</small></span></a>
              <a href="#/design-system?section=nav"><i /><span><strong>Charts</strong><small>@injoffice/charts</small></span></a>
              <a href="#/design-system?section=nav"><i /><span><strong>Collaboration</strong><small>@injoffice/collab</small></span></a>
            </nav>
          </section>

          <section id="chrome">
            <h2>Workbench chrome</h2>
            <p>Toolbar is a single row of controls. The stage keeps the 40px gutter rule so proofs still feel like a manuscript.</p>
            <div className="ds-toolbar">
              <DsButton variant="steel">Use bundled .xlsx</DsButton>
              <DsButton>Open .xlsx</DsButton>
              <DsField label="Target">
                <DsSelect defaultValue="a1">
                  <option value="a1">Data!A1</option>
                  <option value="b2">Plan!B2</option>
                </DsSelect>
              </DsField>
              <DsButton variant="apply">Apply</DsButton>
            </div>
            <div className="ds-stage">
              <DsStatus state="live">Extracted 3 sheets · sha256:bdf753af2b…</DsStatus>
            </div>
          </section>

          <section id="empty">
            <h2>Empty and refused</h2>
            <p>Empty invites an action. Refused names the code and says the file was not replaced.</p>
            <div className="ds-empty">
              <strong>No workbook extracted.</strong>
              <p>Open a .xlsx or use the bundled launch-readiness plan.</p>
            </div>
            <div className="ds-error" role="alert">
              <strong>Apply refused · STALE_REVISION</strong>
              <p>The original bytes were not replaced. Extract again and bind the new package SHA.</p>
            </div>
          </section>

          <section id="presence">
            <h2>Presence</h2>
            <p>Initials plus a cell ref. No avatars, no rainbow stack.</p>
            <div className="ds-row">
              <DsPresence initials="MN" name="Mira North" cell="Data!C4" />
              <DsPresence initials="AK" name="Ada Kim" cell="Plan!A1" />
            </div>
          </section>
        </main>

        <nav className="ds-toc" aria-label="Design system sections">
          {SECTIONS.map((item) => (
            <a
              key={item.id}
              href={`#/design-system?section=${item.id}`}
              aria-current={section === item.id ? 'true' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  )
}
