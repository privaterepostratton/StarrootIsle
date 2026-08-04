/**
 * Shrink an authored GLB to something shippable.
 *
 * Meshy exports arrive at tens of megabytes for a few thousand triangles: the
 * geometry is nothing, the file is three 4K-to-8K JPEGs (baseColour, metallic
 * roughness, normal). This re-encodes the baseColour down to a sane size and, by
 * default, drops the other two maps entirely — the game shades authored props
 * with their baseColour only, so a normal map is bytes the renderer never reads.
 *
 * The glTF's images/textures/samplers wiring is rewritten in place rather than
 * regenerated, so the loader still hands back the authored material fully hooked
 * up. Geometry, accessors and node transforms are untouched.
 *
 *   node scripts/slim-glb.mjs in.glb public/models/out.glb [--size 1024] [--keep-maps]
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const [, , input, output, ...flags] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/slim-glb.mjs <in.glb> <out.glb> [--size N] [--keep-maps]')
  process.exit(1)
}
const sizeFlag = flags.indexOf('--size')
const SIZE = sizeFlag >= 0 ? Number(flags[sizeFlag + 1]) : 1024
const KEEP_MAPS = flags.includes('--keep-maps')

const src = fs.readFileSync(input)
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')

// GLB: 12-byte header, then chunks of [length, type, data]. Exactly two here.
const jsonLen = src.readUInt32LE(12)
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString('utf8'))
const binStart = 20 + jsonLen + 8
const binLen = src.readUInt32LE(20 + jsonLen)
const bin = src.subarray(binStart, binStart + binLen)

const view = (i) => {
  const v = json.bufferViews[i]
  return bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)
}

// Which image each material actually keeps.
const keptImages = new Set()
for (const mat of json.materials ?? []) {
  const pbr = mat.pbrMetallicRoughness ?? {}
  if (pbr.baseColorTexture) keptImages.add(json.textures[pbr.baseColorTexture.index].source)
  if (KEEP_MAPS) {
    if (pbr.metallicRoughnessTexture) keptImages.add(json.textures[pbr.metallicRoughnessTexture.index].source)
    if (mat.normalTexture) keptImages.add(json.textures[mat.normalTexture.index].source)
    if (mat.emissiveTexture) keptImages.add(json.textures[mat.emissiveTexture.index].source)
    if (mat.occlusionTexture) keptImages.add(json.textures[mat.occlusionTexture.index].source)
  } else {
    delete pbr.metallicRoughnessTexture
    delete mat.normalTexture
    delete mat.emissiveTexture
    delete mat.occlusionTexture
    // Without the map, a metallic factor of 1 renders the prop black.
    pbr.metallicFactor = 0
    pbr.roughnessFactor = 0.9
    /*
     * And the emissive factor has to go with the emissive map.
     *
     * These exporters write emissiveFactor [1,1,1] alongside an emissive texture
     * that is mostly black — the factor is a multiplier, and the map is what
     * makes it mean anything. Drop the map alone and the factor multiplies
     * nothing into full white: the model renders as a featureless white
     * silhouette, lit from inside, with its baseColour texture still correctly
     * attached and completely invisible underneath.
     */
    mat.emissiveFactor = [0, 0, 0]
  }
}

const resized = new Map()
for (const i of keptImages) {
  const img = json.images[i]
  const data = view(img.bufferView)
  const out = await sharp(data)
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer()
  resized.set(i, out)
  console.log(`image ${i}: ${(data.length / 1e6).toFixed(1)}MB -> ${(out.length / 1e6).toFixed(2)}MB`)
}

/*
 * Repack: every retained bufferView is copied into a fresh binary chunk in order,
 * with 4-byte alignment, and its byteOffset rewritten. Dropped image views simply
 * are not copied, which is what actually reclaims the megabytes — editing the
 * JSON alone would leave the pixels sitting in the buffer.
 */
const usedViews = new Set()
for (const a of json.accessors ?? []) if (a.bufferView !== undefined) usedViews.add(a.bufferView)
for (const i of keptImages) usedViews.add(json.images[i].bufferView)

const chunks = []
let offset = 0
const remap = new Map()
for (const i of [...usedViews].sort((a, b) => a - b)) {
  const imageIndex = [...keptImages].find((k) => json.images[k].bufferView === i)
  const data = imageIndex !== undefined ? resized.get(imageIndex) : view(i)
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
json.images = json.images.map((img, i) => (keptImages.has(i) ? { ...img, mimeType: 'image/jpeg' } : img))
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
console.log(
  `${input} ${(src.length / 1e6).toFixed(1)}MB -> ${output} ${(fs.statSync(output).size / 1e6).toFixed(2)}MB`,
)
