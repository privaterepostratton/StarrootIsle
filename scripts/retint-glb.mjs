/**
 * Pull the saturation out of one hue range in a GLB's baseColour texture.
 *
 * The game grades every frame through postfx.ts — a contrast curve and a
 * saturation of 1.2 — and that grade is the art direction, not a bug to work
 * around. An authored asset therefore has to arrive *under*-saturated in the
 * hues the grade will push hardest, and a model that looked correct in the
 * neutral model gallery can still come out fluorescent in game.
 *
 * The Farmville trees are the case this was written for: their trunks ship as a
 * strong orange that reads as warm bark on its own and as traffic-cone plastic
 * once the grade is applied. Desaturating the whole texture would take the
 * canopy down with it, so the adjustment is restricted to a hue window and the
 * greens are left exactly as they were.
 *
 *   node scripts/retint-glb.mjs in.glb out.glb --hue 10-50 --sat 0.55 --val 0.86
 *
 * `--hue` is a degree range on the colour wheel (0 = red, 120 = green).
 * `--sat` multiplies saturation inside it, `--val` brightness. The window's
 * outer 12 degrees are feathered so the adjustment does not leave a visible
 * edge where bark meets leaf.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const [, , input, output, ...flags] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/retint-glb.mjs <in.glb> <out.glb> [--hue A-B] [--sat S] [--val V]')
  process.exit(1)
}
const flagStr = (name, fallback) => {
  const i = flags.indexOf(`--${name}`)
  return i >= 0 ? flags[i + 1] : fallback
}
const [HUE_LO, HUE_HI] = flagStr('hue', '10-50').split('-').map(Number)
const SAT = Number(flagStr('sat', '0.55'))
const VAL = Number(flagStr('val', '0.88'))
/** Degrees of feather either side of the window. */
const FEATHER = 12

const src = fs.readFileSync(input)
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')

const jsonLen = src.readUInt32LE(12)
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString('utf8'))
const binStart = 20 + jsonLen + 8
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen))

const viewBytes = (i) => {
  const v = json.bufferViews[i]
  const start = v.byteOffset ?? 0
  return bin.subarray(start, start + v.byteLength)
}

/** Which images are a material's baseColour — the only ones the game shades from. */
const baseColour = new Set()
for (const mat of json.materials ?? []) {
  const tex = mat.pbrMetallicRoughness?.baseColorTexture
  if (tex) baseColour.add(json.textures[tex.index].source)
}
if (baseColour.size === 0) throw new Error('no baseColour texture in this file')

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h *= 60
  if (h < 0) h += 360
  return [h, max === 0 ? 0 : d / max, max]
}

function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m]
}

/** 1 inside the window, easing to 0 across FEATHER degrees either side. */
function weightFor(h) {
  if (h >= HUE_LO && h <= HUE_HI) return 1
  const d = h < HUE_LO ? HUE_LO - h : h - HUE_HI
  // Hues wrap, so a window near red has to see 359 as adjacent to 0.
  const wrapped = Math.min(d, 360 - d)
  return wrapped >= FEATHER ? 0 : 1 - wrapped / FEATHER
}

const rewritten = new Map()
for (const index of baseColour) {
  const img = json.images[index]
  if (img.bufferView === undefined) throw new Error('image is not embedded in the GLB')
  const { data, info } = await sharp(viewBytes(img.bufferView))
    .raw()
    .toBuffer({ resolveWithObject: true })

  let touched = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const [h, s, v] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)
    const w = weightFor(h)
    if (w === 0 || s < 0.05) continue
    touched++
    const [r, g, b] = hsvToRgb(h, s * (1 - w + w * SAT), v * (1 - w + w * VAL))
    data[i] = Math.round(r * 255)
    data[i + 1] = Math.round(g * 255)
    data[i + 2] = Math.round(b * 255)
  }

  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .jpeg({ quality: 88 })
    .toBuffer()
  rewritten.set(index, out)
  const pixels = data.length / info.channels
  console.log(
    `image ${index}: ${info.width}x${info.height}, ${((touched / pixels) * 100).toFixed(1)}% of pixels in hue ${HUE_LO}-${HUE_HI}`,
  )
}

/*
 * Repack, exactly as slim-glb.mjs does: every referenced bufferView is copied
 * into a fresh binary chunk in order, 4-byte aligned, offsets rewritten.
 */
const usedViews = new Set()
for (const a of json.accessors ?? []) if (a.bufferView !== undefined) usedViews.add(a.bufferView)
for (const img of json.images ?? []) if (img.bufferView !== undefined) usedViews.add(img.bufferView)

const chunks = []
let offset = 0
const remap = new Map()
for (const i of [...usedViews].sort((a, b) => a - b)) {
  const imageIndex = [...rewritten.keys()].find((k) => json.images[k].bufferView === i)
  const data = imageIndex !== undefined ? rewritten.get(imageIndex) : viewBytes(i)
  const pad = (4 - (offset % 4)) % 4
  if (pad) {
    chunks.push(Buffer.alloc(pad))
    offset += pad
  }
  remap.set(i, { byteOffset: offset, byteLength: data.length })
  chunks.push(data)
  offset += data.length
}

json.bufferViews = json.bufferViews.map((v, i) => {
  if (!remap.has(i)) return v
  const { byteOffset, byteLength } = remap.get(i)
  return { ...v, byteOffset, byteLength }
})
json.images = json.images.map((img, i) => (rewritten.has(i) ? { ...img, mimeType: 'image/jpeg' } : img))
json.buffers = [{ byteLength: offset }]

const newBin = Buffer.concat(chunks)
let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)])
const binPad = newBin.length % 4 ? Buffer.alloc(4 - (newBin.length % 4)) : Buffer.alloc(0)

const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length + binPad.length, 8)
const jsonHeader = Buffer.alloc(8)
jsonHeader.writeUInt32LE(jsonBuf.length, 0)
jsonHeader.writeUInt32LE(0x4e4f534a, 4)
const binHeader = Buffer.alloc(8)
binHeader.writeUInt32LE(newBin.length + binPad.length, 0)
binHeader.writeUInt32LE(0x004e4942, 4)

fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, newBin, binPad]))
console.log(`wrote ${output} (${(fs.statSync(output).size / 1e6).toFixed(2)}MB)`)
