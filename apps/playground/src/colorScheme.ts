// The public site ships one light theme. There is no toggle, no stored choice and no
// following of the OS preference; editors that accept a dark mode are always given light.
export type ColorScheme = 'light'

export function currentColorScheme(): ColorScheme {
  return 'light'
}

export function applyColorScheme(): void {
  const root = document.documentElement
  root.dataset.theme = 'light'
  root.style.colorScheme = 'light'
}
