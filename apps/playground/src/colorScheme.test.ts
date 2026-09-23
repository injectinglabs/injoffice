import { describe, expect, it } from 'vitest'
import { currentColorScheme } from './colorScheme'
import { bindUniverColorScheme, univerDarkMode } from './univerColorScheme'

describe('playground color scheme', () => {
  it('is always light', () => {
    expect(currentColorScheme()).toBe('light')
  })

  it('keeps every Univer editor in light mode', () => {
    expect(univerDarkMode()).toBe(false)
    const calls: boolean[] = []
    const unbind = bindUniverColorScheme({ toggleDarkMode: (dark) => { calls.push(dark) } })
    unbind()
    expect(calls).toEqual([false])
  })
})
