/**
 * Strip a rigged GLB down to its animation.
 *
 * Meshy exports one file per clip, each carrying a full copy of the mesh, the
 * skin and a 4K texture — 64MB to deliver a two-second wave the game already has
 * the body for. This keeps the node hierarchy and the animation channels and
 * throws away everything else, which is enough for three.js: a clip binds to
 * bones by *name*, so a clip lifted out of one export plays on the skeleton
 * loaded from another as long as the rig is the same.
 *
 * The node list has to stay complete and in order — animation channels target
 * nodes by index, and a hierarchy with holes in it re-binds to the wrong bones.
 *
 *   node scripts/extract-anim.mjs in.glb public/models/out.glb
 */
import fs from 'node:fs'
import path from 'node:path'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/extract-anim.mjs <in.glb> <out.glb>')
  process.exit(1)
}

const src = fs.readFileSync(input)
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')

const jsonLen = src.readUInt32LE(12)
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString('utf8'))
const binStart = 20 + jsonLen + 8
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen))

if (!json.animations?.length) throw new Error('no animations in this file')

/*
 * Accessors are rebuilt rather than filtered in place: once the meshes and skins
 * are gone the only references left are the animation samplers, so the array can
 * be compacted and the sampler indices remapped onto it. Leaving the originals
 * would keep every vertex buffer in the file — which is the whole thing being
 * removed here.
 */
const accessorMap = new Map()
const accessors = []
const keep = (index) => {
  if (accessorMap.has(index)) return accessorMap.get(index)
  const next = accessors.length
  accessorMap.set(index, next)
  accessors.push({ ...json.accessors[index] })
  return next
}

for (const anim of json.animations) {
  for (const sampler of anim.samplers) {
    sampler.input = keep(sampler.input)
    sampler.output = keep(sampler.output)
  }
}

// Repack the retained buffer views, 4-byte aligned, and repoint the accessors.
const chunks = []
let offset = 0
for (const accessor of accessors) {
  const view = json.bufferViews[accessor.bufferView]
  const start = view.byteOffset ?? 0
  const data = bin.subarray(start, start + view.byteLength)
  const pad = (4 - (offset % 4)) % 4
  if (pad) {
    chunks.push(Buffer.alloc(pad))
    offset += pad
  }
  accessor.bufferView = chunks.length
  // Accessors into an interleaved view carry their own offset; the slice above
  // is the whole view, so that offset still applies and must be preserved.
  chunks.push(data)
  offset += data.length
}

const bufferViews = []
let cursor = 0
for (const data of chunks) {
  if (data.length === 0) continue
  bufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: data.length })
  cursor += data.length
}
// Rebuild the mapping now that padding blocks have been dropped from the count.
let viewIndex = 0
let running = 0
const viewFor = new Map()
for (let i = 0; i < chunks.length; i++) {
  if (chunks[i].length === 0) continue
  viewFor.set(i, viewIndex++)
  running += chunks[i].length
}
for (const accessor of accessors) accessor.bufferView = viewFor.get(accessor.bufferView) ?? 0

const nodes = json.nodes.map((node) => {
  const copy = { ...node }
  delete copy.mesh
  delete copy.skin
  return copy
})

const out = {
  asset: json.asset,
  scene: json.scene ?? 0,
  scenes: json.scenes,
  nodes,
  animations: json.animations,
  accessors,
  bufferViews,
  buffers: [{ byteLength: running }],
}

const newBin = Buffer.concat(chunks)
let jsonBuf = Buffer.from(JSON.stringify(out), 'utf8')
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
  `${path.basename(input)} ${(src.length / 1e6).toFixed(1)}MB -> ${output} ${(
    fs.statSync(output).size / 1e3
  ).toFixed(0)}KB  [${json.animations.map((a) => a.name).join(', ')}]`,
)
