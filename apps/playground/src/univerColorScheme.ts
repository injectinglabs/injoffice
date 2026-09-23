/** Univer editors on the public site always run in light mode. */
export function univerDarkMode(): boolean {
  return false
}

/** Pin a live Univer instance to light mode. There is nothing to follow, so the unbind is a no-op. */
export function bindUniverColorScheme(api: { toggleDarkMode(isDarkMode: boolean): void }): () => void {
  api.toggleDarkMode(false)
  return () => {}
}
