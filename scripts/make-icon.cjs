                                             
const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
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

                                  
function drawIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const r = size * 0.22
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0               
    for (let x = 0; x < size; x++) {
             
      const dx = Math.min(x, size - 1 - x)
      const dy = Math.min(y, size - 1 - y)
      let inside = true
      if (dx < r && dy < r) {
        inside = (r - dx) ** 2 + (r - dy) ** 2 <= r * r
      }
      let cr, cg, cb
      if (!inside) {
        cr = cg = cb = 0
      } else {
        const inx = x > size * 0.28 && x < size * 0.72
        const iny = y > size * 0.24 && y < size * 0.78
        if (inx && iny) {
          cr = 255; cg = 255; cb = 255
        } else {
          cr = 78; cg = 110; cb = 242
        }
      }
      raw[o++] = cr; raw[o++] = cg; raw[o++] = cb; raw[o++] = inside ? 255 : 0
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8             
  ihdr[9] = 6        
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png
}

const outDir = path.join(__dirname, '..', 'resources')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.png'), drawIcon(256))
fs.writeFileSync(path.join(outDir, 'iconTemplate_win.png'), drawIcon(32))
console.log('icons written to', outDir)
