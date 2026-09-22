                                       
                                                     
const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

const BRAND = [0x72, 0x6c, 0xff]         
const SS = 4         

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = crc >>> 8
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const dx = Math.min(x - x0, x1 - x)
  const dy = Math.min(y - y0, y1 - y)
  if (dx < r && dy < r) return (r - dx) ** 2 + (r - dy) ** 2 <= r * r
  return true
}

                                    
function shade(x, y) {
            
  const r = 0.22
  const dx = Math.min(x, 1 - x)
  const dy = Math.min(y, 1 - y)
  let inside = true
  if (dx < r && dy < r) inside = (r - dx) ** 2 + (r - dy) ** 2 <= r * r
  if (!inside) return [0, 0, 0, 0]

                            
  if (inRoundRect(x, y, 0.41, 0.17, 0.59, 0.30, 0.04)) return [255, 255, 255, 255]

            
  if (inRoundRect(x, y, 0.27, 0.24, 0.73, 0.80, 0.07)) {
                    
    if (y > 0.41 && y < 0.49 && x > 0.34 && x < 0.66) return [...BRAND, 255]
    if (y > 0.55 && y < 0.63 && x > 0.34 && x < 0.60) return [...BRAND, 255]
    return [255, 255, 255, 255]
  }
  return [...BRAND, 255]
}

function drawIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  const n = SS * SS
  for (let py = 0; py < size; py++) {
    raw[o++] = 0                
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)
          r += c[0]; g += c[1]; b += c[2]; a += c[3]
        }
      }
      raw[o++] = Math.round(r / n)
      raw[o++] = Math.round(g / n)
      raw[o++] = Math.round(b / n)
      raw[o++] = Math.round(a / n)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8             
  ihdr[9] = 6        
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const outDir = path.join(__dirname, '..', 'icons')
fs.mkdirSync(outDir, { recursive: true })
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`)
  fs.writeFileSync(file, drawIcon(size))
  console.log('written', file, fs.statSync(file).size, 'bytes')
}
