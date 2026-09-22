import { getPlatform } from '@main/platform'

   
                                                  
                               
   

export function sendPasteKeys(): void {
  try {
    getPlatform().sendPasteKeys()
  } catch (e) {
    console.error('[clipnest] sendPasteKeys failed', e)
  }
}
