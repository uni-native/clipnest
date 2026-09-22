   
                                           
                                                          
   

const NAMED_KEYS: Record<string, string> = {
  ' ': 'space',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'enter',
  Escape: 'esc',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
}

                              
const NEEDS_MODIFIER = /^[a-z0-9`]$/

export function toAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  if (e.metaKey) mods.push('cmd')

  const key = NAMED_KEYS[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : '')
  if (!key) return null
  if (mods.length === 0 && NEEDS_MODIFIER.test(key)) return null
  return [...mods, key].join('+')
}
