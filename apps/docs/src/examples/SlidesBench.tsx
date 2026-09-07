import { useMemo, useState } from 'react'
import { compileDeckSpecToNativeV1 } from '@injoffice/pptx-authored'
import { DeckView, addSlide, updateSlide, type DeckSpec } from '@injoffice/slides'
import { LiveBench } from '../components/LiveBench'

const START: DeckSpec = {
  id: 'docs-deck',
  title: 'InjOffice',
  theme: 'slate',
  slides: [
    { id: 's1', kind: 'title', title: 'Native Office files', subtitle: 'Original bytes stay authoritative' },
    { id: 's2', kind: 'bullets', title: 'Pipeline', bullets: ['Extract', 'Mutate', 'Apply', 'Reopen'] },
  ],
}

export function SlidesBench() {
  const [spec, setSpec] = useState(START)
  const compiled = useMemo(() => compileDeckSpecToNativeV1(spec), [spec])
  const title = spec.slides[0]?.title ?? ''
  return (
    <LiveBench title="Live example" hint="@injoffice/slides + @injoffice/pptx-authored">
      <div className="bench-controls">
        <label className="field" style={{ flex: 1 }}>
          Title slide
          <input value={title} onChange={(event) => setSpec((current) => updateSlide(current, 0, { title: event.target.value }))} />
        </label>
        <button type="button" className="bench-button" onClick={() => setSpec((current) => addSlide(current, current.slides.length - 1, 'bullets'))}>Add slide</button>
      </div>
      {compiled.ok
        ? <p><span className="badge badge--pass">compiled</span> {compiled.deck.slides.length} native slide{compiled.deck.slides.length === 1 ? '' : 's'}</p>
        : (
          <div>
            <p><span className="badge badge--patch">refused</span></p>
            <ul>{compiled.issues.map((issue) => <li key={issue.path}><code>{issue.code}</code> {issue.message}</li>)}</ul>
          </div>
        )}
      <div className="deck-preview">
        <DeckView spec={spec} showNotes={false} />
      </div>
    </LiveBench>
  )
}
