import { getPlatform } from '@main/platform'

   
                                          
   

                                      
export function saveForeground(): number | null {
  return getPlatform().saveForeground()
}

                                                 
export function restoreForeground(handle: number | null): void {
  if (handle === null || handle === 0) return
  try {
    getPlatform().restoreForeground(handle)
  } catch (e) {
    console.error('[clipnest] restoreForeground failed', e)
  }
}
