import fs from 'fs'
import * as THREE from 'three'

const b = fs.readFileSync('F:/Games/GrowAGardenTwo/public/models/goat.glb')
const jsonLen = b.readUInt32LE(12)
const j = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'))
const binOff = 20 + jsonLen + 8

function accFloat(i) {
  const a = j.accessors[i]
  const bv = j.bufferViews[a.bufferView]
  const off = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0)
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type]
  const out = []
  for (let k = 0; k < a.count; k++) {
    const row = []
    for (let c = 0; c < n; c++) row.push(b.readFloatLE(off + (k * n + c) * 4))
    out.push(row)
  }
  return out
}

// build Object3D graph
const objs = j.nodes.map((n) => {
  const o = new THREE.Object3D()
  o.name = n.name
  if (n.translation) o.position.fromArray(n.translation)
  if (n.rotation) o.quaternion.fromArray(n.rotation)
  if (n.scale) o.scale.fromArray(n.scale)
  return o
})
j.nodes.forEach((n, i) => (n.children || []).forEach((c) => objs[i].add(objs[c])))
const root = objs[j.scenes[0].nodes[0]]
root.updateMatrixWorld(true)

const p = new THREE.Vector3()
console.log('--- rest joint world positions (scene space) ---')
const skin = j.skins[0]
for (const ji of skin.joints) {
  objs[ji].getWorldPosition(p)
  console.log(objs[ji].name.padEnd(14), p.toArray().map((v) => v.toFixed(4)).join('\t'))
}

// mesh bounds
const mesh = j.meshes[0]
const posAcc = j.accessors[mesh.primitives[0].attributes.POSITION]
console.log('\nPOSITION min', posAcc.min, 'max', posAcc.max, 'count', posAcc.count)

// inverse bind matrices -> bind world matrices
const ibm = accFloat(skin.inverseBindMatrices)
const m = new THREE.Matrix4()
console.log('\n--- bind world matrix decomposition (from IBM inverse) ---')
const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
skin.joints.forEach((ji, k) => {
  m.fromArray(ibm[k]).invert()
  m.decompose(pos, q, s)
  console.log(
    j.nodes[ji].name.padEnd(14),
    'pos', pos.toArray().map((v) => v.toFixed(3)).join(','),
    'scale', s.toArray().map((v) => v.toFixed(3)).join(','),
  )
})

// bone local axis directions in world for a few key bones
console.log('\n--- bone local axes in world (rest) ---')
for (const nm of ['Hips', 'chest', 'head', 'headend', 'earend', 'frontleg', 'frontleg2', 'backleg', 'tail', 'tail3']) {
  const o = objs.find((x) => x.name === nm)
  const mw = o.matrixWorld
  const e = mw.elements
  const ax = new THREE.Vector3(e[0], e[1], e[2]).normalize()
  const ay = new THREE.Vector3(e[4], e[5], e[6]).normalize()
  const az = new THREE.Vector3(e[8], e[9], e[10]).normalize()
  console.log(nm.padEnd(11),
    'X→', ax.toArray().map((v) => v.toFixed(2)).join(','),
    ' Y→', ay.toArray().map((v) => v.toFixed(2)).join(','),
    ' Z→', az.toArray().map((v) => v.toFixed(2)).join(','))
}
