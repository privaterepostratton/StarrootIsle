import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Flatten a built model group into a single geometry with its material colours
 * baked into vertex colours.
 *
 * The procedural models are groups of a dozen small meshes each, which is fine
 * for a handful of hero props but ruinous for a forest — a few hundred trees
 * becomes a few thousand draw calls. Baking a variant once and drawing it with
 * an InstancedMesh turns the whole forest into one draw call per variant.
 */
function bakeMeshPart(mesh: THREE.Mesh, keepUv: boolean): THREE.BufferGeometry {
  // Non-indexed so every part has an identical attribute layout; mergeGeometries
  // refuses to combine a mix of indexed and non-indexed inputs.
  const geo = mesh.geometry.clone().toNonIndexed()
  geo.applyMatrix4(mesh.matrixWorld)

  const material = mesh.material as THREE.MeshLambertMaterial
  const color = material.color

  const count = geo.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  // Drop anything the merged geometry does not need. Mismatched attribute
  // sets are the other way mergeGeometries fails.
  for (const name of Object.keys(geo.attributes)) {
    const keep = name === 'position' || name === 'normal' || name === 'color' || (keepUv && name === 'uv')
    if (!keep) geo.deleteAttribute(name)
  }
  if (!geo.attributes.normal) geo.computeVertexNormals()
  if (keepUv && !geo.attributes.uv) {
    // Fallback so foliage merges never mix uv/no-uv attributes.
    const uvs = new Float32Array(count * 2)
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  }

  return geo
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) return new THREE.BufferGeometry()
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged ?? new THREE.BufferGeometry()
}

/**
 * `keepUv` carries each part's own UVs through the merge, for callers whose
 * baked material samples a map. Off by default: most baked props are vertex
 * colour only, and a UV attribute they never read is pure vertex bandwidth
 * across a few thousand instances.
 */
export function bakeGroup(root: THREE.Object3D, keepUv = false): THREE.BufferGeometry {
  root.updateMatrixWorld(true)

  const parts: THREE.BufferGeometry[] = []
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    parts.push(bakeMeshPart(mesh, keepUv))
  })

  return mergeParts(parts)
}

export interface BakedParts {
  /** Trunk, cores, rocks — vertex colour only. */
  solid: THREE.BufferGeometry
  /** Leaf cards with UVs for a textured cutout material. */
  foliage: THREE.BufferGeometry | null
}

/**
 * Split a model into solid + foliage geos. Meshes tagged with
 * `userData.foliage` keep their UVs so a leaf-card map can alpha-test.
 */
export function bakeGroupParts(root: THREE.Object3D): BakedParts {
  root.updateMatrixWorld(true)

  const solidParts: THREE.BufferGeometry[] = []
  const foliageParts: THREE.BufferGeometry[] = []

  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.userData.foliage) foliageParts.push(bakeMeshPart(mesh, true))
    else solidParts.push(bakeMeshPart(mesh, false))
  })

  return {
    solid: mergeParts(solidParts),
    foliage: foliageParts.length > 0 ? mergeParts(foliageParts) : null,
  }
}

/** Placement for one instance of a baked variant. */
export interface Placement {
  x: number
  y: number
  z: number
  rotationY: number
  scale: number
}

export interface InstanceOptions {
  material?: THREE.Material
  castShadow?: boolean
  receiveShadow?: boolean
  layer?: number
  /** Per-instance RGB, parallel to `placements`. */
  colors?: number[]
  /** World-space size of each spatial chunk. */
  chunkSize?: number
}

/**
 * Build instanced meshes from a baked geometry and a list of placements,
 * split into spatial chunks.
 *
 * The chunking is what makes this affordable. A single InstancedMesh spanning
 * the whole valley has one bounding volume covering the whole valley, so it is
 * either fully drawn or fully culled — in practice always fully drawn, which
 * means every distant tree and every blade of grass behind the camera still
 * costs vertex work. Splitting by chunk gives each batch a tight bounding
 * sphere, so the frustum test actually discards most of the world.
 */
export function makeInstancedChunks(
  geometry: THREE.BufferGeometry,
  placements: Placement[],
  opts: InstanceOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  if (placements.length === 0) return group

  const chunkSize = opts.chunkSize ?? 48
  const material = opts.material ?? new THREE.MeshLambertMaterial({ vertexColors: true })

  // Bucket by chunk, carrying the original index so per-instance colours stay
  // aligned after the regrouping.
  const buckets = new Map<string, number[]>()
  placements.forEach((p, i) => {
    const key = `${Math.floor(p.x / chunkSize)}:${Math.floor(p.z / chunkSize)}`
    let bucket = buckets.get(key)
    if (!bucket) buckets.set(key, (bucket = []))
    bucket.push(i)
  })

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  for (const indices of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, indices.length)

    indices.forEach((srcIndex, i) => {
      const p = placements[srcIndex]
      q.setFromAxisAngle(up, p.rotationY)
      pos.set(p.x, p.y, p.z)
      scl.setScalar(p.scale)
      m.compose(pos, q, scl)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true

    if (opts.colors) {
      const colors = new Float32Array(indices.length * 3)
      indices.forEach((srcIndex, i) => {
        colors[i * 3] = opts.colors![srcIndex * 3]
        colors[i * 3 + 1] = opts.colors![srcIndex * 3 + 1]
        colors[i * 3 + 2] = opts.colors![srcIndex * 3 + 2]
      })
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
      mesh.instanceColor.needsUpdate = true
    }

    mesh.castShadow = opts.castShadow ?? true
    mesh.receiveShadow = opts.receiveShadow ?? true
    if (opts.layer !== undefined) mesh.layers.set(opts.layer)

    // Accounts for the instance matrices, so the frustum test is tight.
    mesh.computeBoundingSphere()
    /*
     * Chunks never move after they are built, so opt out of the per-frame matrix
     * walk. With a few hundred chunks in the scene that walk is pure overhead —
     * three recomposes a matrix from position/quaternion/scale for every one of
     * them, every frame, to arrive at the same answer it had last frame.
     */
    mesh.updateMatrix()
    mesh.matrixAutoUpdate = false
    group.add(mesh)
  }

  return group
}
