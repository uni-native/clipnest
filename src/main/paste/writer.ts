import { clipboard, nativeImage } from 'electron'
import type { ClipboardSnapshot } from '@shared/types'
import { getPlatform } from '@main/platform'

   
                                                   
                                                  
   

export function writeText(text: string): void {
  getPlatform().writeText(text)
}

export function writeHtml(html: string, plain: string): void {
  getPlatform().writeHtml(html, plain)
}

export function writeImageFile(path: string): void {
  getPlatform().writeImageFile(path)
}

export function writeFilePaths(paths: string[]): void {
  getPlatform().writeFilePaths(paths)
}

                                                         
export function writeImageDataUrl(dataUrl: string): void {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('writeImageDataUrl: empty image')
  clipboard.writeImage(image)
}

export function readSnapshot(): ClipboardSnapshot {
  return getPlatform().readClipboard()
}

const HTML_TAG = /<[a-z!/][^>]*>/i

export function looksLikeHtml(raw: string): boolean {
  return HTML_TAG.test(raw)
}

                                                   
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

                                            
export function writeRichText(raw: string, fallbackPlain: string): void {
  if (looksLikeHtml(raw)) {
    writeHtml(raw, stripHtml(raw) || fallbackPlain)
    return
  }
  writeText(raw.length > 0 ? raw : fallbackPlain)
}
