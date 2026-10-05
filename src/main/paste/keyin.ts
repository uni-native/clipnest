import { getPlatform } from '@main/platform'

   
                                                  
                               
   

export function sendPasteKeys(): void {
  try {
    getPlatform().sendPasteKeys()
  } catch (e) {
    console.error('[pasteman] sendPasteKeys failed', e)
  }
}
