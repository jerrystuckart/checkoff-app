// Generates 12 flat gradient PLACEHOLDER PNGs for the Nearby category rail.
// Final photography replaces these files 1:1 (same filenames) — no code change.
// Usage: node scripts/generate-nearby-category-placeholders.js
const fs = require('fs'), zlib = require('zlib'), path = require('path')

const ACCENTS = {
  adventure: '#E8833A', 'arts-culture': '#B05FD6', 'bar-drinks': '#E0457B',
  'food-drink': '#E5A52E', misc: '#4FB3A9', nightlife: '#6C5CE7',
  play: '#3DB2F2', shopping: '#F06A8E', social: '#F2B84B',
  'spa-self-care': '#6FCFA0', sports: '#4C9F38', travel: '#2F80ED',
}
const SIZE = 256
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }

function png(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const rows = []
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 3)
    for (let x = 0; x < SIZE; x++) {
      const t = (x + y) / (2 * SIZE) // diagonal: bright top-left → deeper bottom-right
      const f = 1.15 - 0.6 * t
      row[1 + x * 3] = Math.min(255, r * f); row[2 + x * 3] = Math.min(255, g * f); row[3 + x * 3] = Math.min(255, b * f)
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
const dir = path.join(__dirname, '..', 'assets', 'nearby-categories')
for (const [id, hex] of Object.entries(ACCENTS)) fs.writeFileSync(path.join(dir, `${id}.png`), png(hex))
console.log('wrote', Object.keys(ACCENTS).length, 'placeholders to', dir)
