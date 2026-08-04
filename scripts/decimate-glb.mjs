/**
 * Reduce an authored GLB's triangle count in place.
 *
 * The sibling script slim-glb.mjs shrinks the *file* — these exports are almost
 * entirely texture bytes, so that is the right first cut and it leaves geometry
 * alone on purpose. This one addresses the other cost, which slimming cannot
 * touch: a prop is drawn hundreds of times a frame, so its triangles are
 * multiplied by its instance count while its file size is paid once.
 *
 * The bush is the case that motivated it. As authored it is ~3000 triangles,
 * against 240 for the procedural blob it replaces, and vegetation.ts plants 520
 * of them — 1.5M triangles a frame for shrubbery the player walks past. At a
 * quarter of that the silhouette is unchanged at the size it is actually seen.
 *
 *   node scripts/decimate-glb.mjs in.glb out.glb [--ratio 0.25] [--error 0.05]
 *
 * `--ratio` is the fraction of triangles to keep. `--error` caps how far the
 * surface may move, as a fraction of the mesh's own size; the simplifier stops
 * early rather than exceed it, so a low ratio is a request, not a promise — the
 * reported result is what actually happened.
 */
import fs from 'node:fs'
import path from 'node:path'
import { MeshoptSimplifier } from 'meshoptimizer'

const [, , input, output, ...flags] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/decimate-glb.mjs <in.glb> <out.glb> [--ratio R] [--error E]')
  process.exit(1)
}
const flagNum = (name, fallback) => {
  const i = flags.indexOf(`--${name}`)
  return i >= 0 ? Number(flags[i + 1]) : fallback
}
const RATIO = flagNum('ratio', 0.25)
const ERROR = flagNum('error', 0.05)

await MeshoptSimplifier.ready

const src = fs.readFileSync(input)
if (src.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')

// GLB: 12-byte header, then chunks of [length, type, data]. Exactly two here.
const jsonLen = src.readUInt32LE(12)
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString('utf8'))
const binStart = 20 + jsonLen + 8
const binLen = src.readUInt32LE(20 + jsonLen)
const bin = src.subarray(binStart, binStart + binLen)

const viewBytes = (i) => {
  const v = json.bufferViews[i]
  const start = v.byteOffset ?? 0
  return bin.subarray(start, start + v.byteLength)
}

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }

/** An accessor's data as a typed array, honouring an interleaved byteStride. */
function readAccessor(index) {
  const acc = json.accessors[index]
  const view = json.bufferViews[acc.bufferView]
  const bytes = viewBytes(acc.bufferView)
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type]
  const size = COMPONENT_BYTES[acc.componentType]
  const stride = view.byteStride ?? comps * size
  const start = acc.byteOffset ?? 0

  const Ctor = acc.componentType === 5125 ? Uint32Array : acc.componentType === 5123 ? Uint16Array : Float32Array
  const out = new Ctor(acc.count * comps)
  for (let i = 0; i < acc.count; i++) {
    const at = start + i * stride
    for (let c = 0; c < comps; c++) {
      out[i * comps + c] =
        Ctor === Float32Array
          ? bytes.readFloatLE(at + c * size)
          : size === 4
            ? bytes.readUInt32LE(at + c * size)
            : bytes.readUInt16LE(at + c * size)
    }
  }
  return out
}

/*
 * New index data is appended as fresh bufferViews rather than written over the
 * old ones: the simplified buffer is a different length, and every accessor
 * after it in the binary chunk would need shifting. The repack at the end drops
 * whatever is left unreferenced, so the originals cost nothing.
 */
const extraViews = []
let before = 0
let after = 0

for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    if (prim.indices === undefined || prim.attributes?.POSITION === undefined) continue

    const indices = Uint32Array.from(readAccessor(prim.indices))
    const positions = Float32Array.from(readAccessor(prim.attributes.POSITION))
    before += indices.length / 3

    const target = Math.max(3, Math.floor((indices.length * RATIO) / 3) * 3)
    const [simplified, error] = MeshoptSimplifier.simplify(indices, positions, 3, target, ERROR)
    after += simplified.length / 3

    // Vertices are left in place. Unreferenced ones cost buffer bytes but no
    // per-frame work — indexed draws only shade what the index buffer names —
    // and compacting would mean rebuilding every other attribute in lockstep.
    const wide = positions.length / 3 > 65535
    const data = wide ? Buffer.from(Uint32Array.from(simplified).buffer) : Buffer.from(Uint16Array.from(simplified).buffer)

    json.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: data.length, target: 34963 })
    extraViews.push(data)

    json.accessors[prim.indices] = {
      bufferView: json.bufferViews.length - 1,
      componentType: wide ? 5125 : 5123,
      count: simplified.length,
      type: 'SCALAR',
    }

    console.log(
      `${mesh.name ?? 'mesh'}: ${indices.length / 3} -> ${simplified.length / 3} tris (error ${(error * 100).toFixed(2)}%)`,
    )
  }
}

/*
 * Repack, exactly as slim-glb.mjs does: every still-referenced bufferView is
 * copied into a fresh binary chunk in order, 4-byte aligned, with its offset
 * rewritten. The superseded index views are simply not copied.
 */
const usedViews = new Set()
for (const a of json.accessors ?? []) if (a.bufferView !== undefined) usedViews.add(a.bufferView)
for (const img of json.images ?? []) if (img.bufferView !== undefined) usedViews.add(img.bufferView)

const newViewIndex = json.bufferViews.length - extraViews.length
const chunks = []
let offset = 0
const remap = new Map()
for (const i of [...usedViews].sort((a, b) => a - b)) {
  const data = i >= newViewIndex ? extraViews[i - newViewIndex] : viewBytes(i)
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
  `${before} -> ${after} tris · ${(src.length / 1e6).toFixed(2)}MB -> ${(fs.statSync(output).size / 1e6).toFixed(2)}MB`,
)
