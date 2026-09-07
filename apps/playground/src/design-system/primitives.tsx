import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

export function DsSheetsMark() {
  return (
    <span className="ds-sheets-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="4" y="3" width="16" height="18" rx="1.5" fill="currentColor" opacity="0.2" />
        <path fill="currentColor" d="M7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h6v2H7v-2z" />
      </svg>
    </span>
  )
}

export function DsButton({
  variant = 'text',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'text' | 'filled' | 'green' | 'outlined' | 'refuse' }) {
  return <button type="button" {...props} className={`ds-btn ds-btn--${variant}${props.className ? ` ${props.className}` : ''}`} />
}

export function DsTool(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className="ds-tool" />
}

export function DsField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ds-field">{label}{children}</label>
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

export function DsChip({
  tone = 'plain',
  children,
}: {
  tone?: 'plain' | 'green' | 'blue' | 'refuse'
  children: ReactNode
}) {
  return <span className={`ds-chip ds-chip--${tone}`}>{children}</span>
}

export function DsCallout({
  tone = 'note',
  title,
  children,
}: {
  tone?: 'note' | 'green' | 'refuse'
  title: string
  children: ReactNode
}) {
  return (
    <div className={`ds-callout ds-callout--${tone}`} role={tone === 'refuse' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  )
}

export function DsAvatar({
  initials,
  tone = 1,
}: {
  initials: string
  tone?: 1 | 2 | 3
}) {
  return <span className={`ds-avatar${tone === 1 ? '' : ` ds-avatar--${tone}`}`}>{initials}</span>
}
