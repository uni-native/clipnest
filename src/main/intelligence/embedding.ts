import { readFileSync } from 'node:fs'

   
                                  
  
                                      
                                                    
                               
                                         
   

export const BUILTIN_MODEL = 'builtin-hash-v1'
const DIM = 512

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

                                                 
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  if (!text) return tokens
  const lower = text.toLowerCase()

  for (const m of lower.matchAll(
    /https?:\/\/[^\s]+|[\w.+-]+@[\w-]+\.[\w.]+|(?<!\d)1[3-9]\d{9}(?!\d)/g,
  )) {
    tokens.push('A:' + m[0])
  }
  for (const m of lower.matchAll(/[a-z0-9][a-z0-9'+#.-]{1,}/g)) {
    tokens.push('W:' + m[0])
  }
  for (const seg of text.match(/[\u4e00-\u9fa5]+/g) || []) {
    for (let i = 0; i < seg.length; i++) {
      tokens.push('C:' + seg[i])
      if (i + 1 < seg.length) tokens.push('B:' + seg.slice(i, i + 2))
    }
  }
  return tokens
}

                    
export function embedText(text: string): Float32Array {
  const v = new Float32Array(DIM)
  for (const t of tokenize(text)) {
    v[fnv1a(t) % DIM] += 1
  }
  let norm = 0
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) v[i] /= norm
  }
  return v
}

                             
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

                                               
export function vecToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function blobToVec(b: Buffer): Float32Array {
  const buf = Buffer.from(b)
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
}

                                                          
export function readPostContent(contentPath: string | null, preview: string): string {
  if (contentPath) {
    try {
      return readFileSync(contentPath, 'utf8')
    } catch {
                         
    }
  }
  return preview
}
