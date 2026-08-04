import * as THREE from 'three'
import type { LoadedModel } from './models'

/**
 * Tree impostors: the far forest as photographs of itself.
 *
 * Two-thirds of the trees in the valley stand beyond where the player can
 * meaningfully look at one — they exist to be a treeline. Drawing ~2,400
 * triangles of authored geometry for each of them made the distant forest the
 * single biggest triangle bill in the frame. An impostor replaces each far tree
 * with one camera-facing quad wearing a snapshot of the real model, cutting it
 * to two triangles that are pixel-for-pixel indistinguishable at that range.
 *
 * The snapshot is taken at load time by rendering the real mesh once into a
 * small render target under flat white ambient light — so the texture holds
 * pure albedo, and the quad's *material* (Lambert) re-lights it with the live
 * sun exactly like every real tree. That is what keeps the far forest dimming
 * through dusk in step with the near one; baking the lighting into the
 * snapshot instead would leave the horizon glowing at midnight.
 */

/** Snapshot resolution. At impostor distances one tree is well under 100px. */
const ATLAS_SIZE = 256

export interface Impostor {
  /** The snapshot, ready to be worn by billboard quads. */
  texture: THREE.Texture
  /** World-unit width of the quad for a height-1 tree. */
  aspect: number
}

/**
 * Photograph a model straight-on for use as a billboard.
 *
 * The camera is orthographic and horizontal: impostors are seen from a shallow
 * game-camera angle, and a straight-on capture distorts least over the small
 * range of pitches the camera can actually take.
 */
export function captureImpostor(renderer: THREE.WebGLRenderer, model: LoadedModel): Impostor {
  const box = model.geometry.boundingBox!
  const size = new THREE.Vector3()
  box.getSize(size)
  const width = Math.max(size.x, size.z)

  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(model.geometry, model.material)
  scene.add(mesh)
  // Flat white light: the render target ends up holding plain albedo.
  scene.add(new THREE.AmbientLight(0xffffff, 3.1))

  const half = 1.02 // sliver of margin so mip filtering never clips the crown
  const camera = new THREE.OrthographicCamera(
    (-width / 2) * half,
    (width / 2) * half,
    box.max.y * half,
    box.min.y * half,
    0.01,
    width * 4,
  )
  camera.position.set(0, 0, width * 2)
  camera.lookAt(0, 0, 0)

  const target = new THREE.WebGLRenderTarget(ATLAS_SIZE, ATLAS_SIZE, {
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
  })

  const prevTarget = renderer.getRenderTarget()
  const prevClear = renderer.getClearColor(new THREE.Color())
  const prevAlpha = renderer.getClearAlpha()
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  renderer.render(scene, camera)
  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClear, prevAlpha)

  return { texture: target.texture, aspect: width / (box.max.y - box.min.y) }
}

/** Where an impostor tree stands, and how tall. */
export interface ImpostorPlacement {
  x: number
  y: number
  z: number
  /** Final world height of the tree. */
  height: number
}

/**
 * All far trees of one species as a single instanced draw.
 *
 * The quads are billboarded in the vertex shader around the Y axis only — a
 * tree that tilted back to face a high camera would visibly lie down. The
 * instance matrix contributes position and scale; its rotation is discarded by
 * construction, since only the translation column and basis length are read.
 */
export function createImpostorField(
  impostor: Impostor,
  placements: ImpostorPlacement[],
): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(impostor.aspect, 1)
  // Origin at the trunk base, so instance Y is simply the ground.
  geo.translate(0, 0.5, 0)
  // Quads are lit like ground, not like walls: every normal points up, so the
  // sun and the day cycle shade the far forest without the shading swinging as
  // the billboard turns.
  const normals = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0)

  const material = new THREE.MeshLambertMaterial({
    map: impostor.texture,
    // Cutout, not blend: at hundreds of overlapping crowns, alpha sorting is
    // hopeless and cutout is free.
    alphaTest: 0.4,
    side: THREE.DoubleSide,
  })

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      // Y-locked billboard. The instance matrix is deliberately reduced to its
      // translation and uniform scale; the quad's orientation comes from the
      // camera alone.
      vec3 iOrigin = vec3(instanceMatrix[3]);
      float iScale = length(instanceMatrix[0].xyz);
      vec3 toCam = cameraPosition - iOrigin;
      toCam.y = 0.0;
      // Degenerate only if the camera is exactly overhead, which the iso rig
      // cannot reach.
      toCam = normalize(toCam);
      vec3 bbRight = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
      vec3 worldPos =
        iOrigin + bbRight * transformed.x * iScale + vec3(0.0, transformed.y * iScale, 0.0);
      vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      `,
    )
  }

  const mesh = new THREE.InstancedMesh(geo, material, placements.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  placements.forEach((p, i) => {
    pos.set(p.x, p.y, p.z)
    scl.setScalar(p.height)
    mesh.setMatrixAt(i, m.compose(pos, q, scl))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  // The billboard shader can swing a crown's width outside the sphere computed
  // from the matrices; pad rather than risk a pop at the frustum edge.
  mesh.boundingSphere!.radius += 4
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.updateMatrix()
  mesh.matrixAutoUpdate = false
  return mesh
}
