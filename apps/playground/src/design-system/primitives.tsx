import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function DsMark() {
  return <span className="ds-mark" aria-hidden="true"><i /><i /><i /></span>
}

export function DsButton({
  variant = 'sheet',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'sheet' | 'apply' | 'steel' | 'ghost' | 'refuse' }) {
  return <button type="button" {...props} className={`ds-btn ds-btn--${variant}${props.className ? ` ${props.className}` : ''}`} />
}

export function DsField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="ds-field">
      {label}
      {children}
    </label>
  )
}

export function DsInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />
}

export function DsSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />
}

export function DsTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />
}

export function DsBadge({
  tone = 'plain',
  children,
}: {
  tone?: 'plain' | 'applied' | 'refused' | 'steel'
  children: ReactNode
}) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>
}

export function DsStatus({
  state,
  children,
}: {
  state: 'live' | 'down' | 'idle'
  children: ReactNode
}) {
  return (
    <span className={`ds-status ds-status--${state}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

export function DsCallout({
  tone = 'note',
  title,
  children,
}: {
  tone?: 'note' | 'applied' | 'refused'
  title: string
  children: ReactNode
}) {
  return (
    <div className={`ds-callout ds-callout--${tone}`} role={tone === 'refused' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  )
}

export function DsTabs({
  value,
  options,
  onChange,
  label,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
  label: string
}) {
  return (
    <div className="ds-tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function DsFileObject({
  name,
  detail,
  runtime,
  children,
}: {
  name: string
  detail: string
  runtime: string
  children?: ReactNode
}) {
  return (
    <article className="ds-file">
      <header>
        <div>
          <strong>{name}</strong>
          <span>{detail}</span>
        </div>
        <DsBadge tone="steel">{runtime}</DsBadge>
      </header>
      {children}
    </article>
  )
}

export function DsProof({ steps }: { steps: { title: string; detail: string }[] }) {
  return (
    <ol className="ds-proof">
      {steps.map((step) => (
        <li key={step.title}>
          <div>
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function DsPresence({
  initials,
  name,
  cell,
}: {
  initials: string
  name: string
  cell: string
}) {
  return (
    <span className="ds-presence">
      <b aria-hidden="true">{initials}</b>
      {name}
      <span className="ds-hash">{cell}</span>
    </span>
  )
}
