import { statSync } from 'node:fs'
import { extname } from 'node:path'
import type { ClipboardSnapshot, ContentType } from '@shared/types'

                             
const URL_RE = /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/i

   
                                                            
                                                  
                                                      
                                                   
                                        
   
const IMAGE_FILE_TYPE: ContentType = 'file'

              
const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.tif',
  '.tiff',
  '.svg',
  '.avif',
  '.heic',
])

                                       
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

   
                                              
                                                         
   
export function classifySnapshot(snapshot: ClipboardSnapshot): ContentType {
  const { formats, filePath, imageDataUrl } = snapshot
  if (formats.includes('image/png') && imageDataUrl) return 'image'
  if (filePath) {
    if (isDirectory(filePath)) return 'folder'
    if (IMAGE_EXTS.has(extname(filePath).toLowerCase())) return IMAGE_FILE_TYPE
    return 'file'
  }
  const text = snapshot.text.replace(/\u0000/g, '').trim()
  if (URL_RE.test(text)) return 'link'
  return 'text'
}
