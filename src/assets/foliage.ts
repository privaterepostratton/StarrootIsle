import * as THREE from 'three'
import { getGroundTextures, tiled } from './textures'

/**
 * Instanced trees/bushes are baked to vertex colours (no UVs), so foliage
 * detail is applied in the material: sample a leaf/pine albedo using
 * model-space position as UVs, and only on green vertex colours so bark stays
 * clean.
 */

function injectFoliageMap(
  material: THREE.MeshLambertMaterial,
  map: THREE.Texture,
  opts: { scale: number; always?: boolean },
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFoliageMap = { value: map }
    shader.uniforms.uFoliageScale = { value: opts.scale }
    shader.uniforms.uFoliageAlways = { value: opts.always ? 1 : 0 }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vFoliagePos;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vFoliagePos = position;
        `,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform sampler2D uFoliageMap;
        uniform float uFoliageScale;
        uniform float uFoliageAlways;
        varying vec3 vFoliagePos;
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          vec2 fUv = vFoliagePos.xz * uFoliageScale * 0.55
            + vFoliagePos.xy * uFoliageScale * 0.35;
          vec4 foliage = texture2D(uFoliageMap, fUv);
          float greenness = clamp((vColor.g - max(vColor.r, vColor.b)) * 3.2 + 0.25, 0.0, 1.0);
          float w = mix(greenness, 1.0, uFoliageAlways);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * foliage.rgb, w * 0.92);
        }
        `,
      )
  }
  material.customProgramCacheKey = () =>
    `foliage|${opts.scale}|${opts.always ? 1 : 0}|${map.uuid}`
}

/** Bushes are all foliage, so the map applies everywhere. */
export function createBushFoliageMaterial(): THREE.MeshLambertMaterial {
  const map = tiled(getGroundTextures().leaf, 1)
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  injectFoliageMap(material, map, { scale: 2.2, always: true })
  return material
}


