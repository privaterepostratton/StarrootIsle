import * as THREE from 'three'
import { createPathTile, createBeehive, type BeehiveModel } from '../assets/decor'
import { MINOR_LAYER, setLayer } from '../assets/style'
import { groundHeight, isWalkable } from './terrain'
import { getModels, modelGroup, PROP_HEIGHT } from '../assets/models'
import type { Farm, Tile } from './farm'

/**
 * Freely-placed world objects: decorations and beehives.
 *
 * Distinct from sprinklers, which occupy a farm plot and are owned by the Farm.
 * These sit anywhere walkable, which is what makes decorating feel like
 * decorating rather than filling in a grid.
 *
 * Beehives live here rather than in their own system because placement,
 * persistence and removal are identical — only the per-frame behaviour differs.
 */

export type PlaceableCategory = 'decor' | 'utility'

export interface PlaceableDef {
  id: string
  name: string
  emoji: string
  price: number
  unlockLevel: number
  category: PlaceableCategory
  blurb: string
  /** Collider radius. Zero means the player walks straight through it. */
  radius: number
  build(): THREE.Object3D | BeehiveModel
}

/** Radius in world units within which a hive pollinates and gathers. */
export const HIVE_RADIUS = 7

/** Seconds to fill a hive with honey at the base rate. */
export const HIVE_BASE_SECONDS = 150

export const PLACEABLES: PlaceableDef[] = [
  {
    id: 'path', name: 'Path Stone', emoji: '🪨', price: 40, unlockLevel: 1, category: 'decor',
    blurb: 'Lay them in a run to make a walkway.',
    radius: 0, build: createPathTile,
  },
  {
    id: 'flowerbed', name: 'Flower Bed', emoji: '🌷', price: 260, unlockLevel: 2, category: 'decor',
    blurb: 'A planter of mixed blooms. Bees like them.',
    radius: 0.5,
    build: () => modelGroup(getModels().flowerBed, PROP_HEIGHT.flowerBed),
  },
  {
    id: 'bench', name: 'Bench', emoji: '🪑', price: 420, unlockLevel: 3, category: 'decor',
    blurb: 'Somewhere to admire the view from.',
    radius: 0.7, build: () => modelGroup(getModels().bench, PROP_HEIGHT.bench),
  },
  {
    id: 'lamp', name: 'Lamp Post', emoji: '💡', price: 700, unlockLevel: 4, category: 'decor',
    blurb: 'Glows after dark.',
    radius: 0.25, build: () => modelGroup(getModels().lantern, PROP_HEIGHT.lantern),
  },
  {
    id: 'scarecrow', name: 'Scarecrow', emoji: '🎃', price: 1200, unlockLevel: 5, category: 'decor',
    blurb: 'Watches over the field. Mostly for the look.',
    radius: 0.3, build: () => modelGroup(getModels().scarecrow, PROP_HEIGHT.scarecrow),
  },
  {
    id: 'hive', name: 'Beehive', emoji: '🐝', price: 2600, unlockLevel: 6, category: 'utility',
    blurb: 'Makes honey, and pollinates crops growing nearby.',
    radius: 0.45, build: createBeehive,
  },
]

export const PLACEABLE_BY_ID = new Map(PLACEABLES.map((p) => [p.id, p]))

interface Placed {
  def: PlaceableDef
  object: THREE.Object3D
  /** Only set for hives. */
  hive: BeehiveModel | null
  x: number
  z: number
  rotation: number
  /** Hive only: 0..1 fill. */
  honey: number
}

export class Placeables {
  readonly group = new THREE.Group()
  private readonly items: Placed[] = []

  private readonly listeners = new Set<() => void>()

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  get count() {
    return this.items.length
  }

  countOf(id: string) {
    return this.items.filter((i) => i.def.id === id).length
  }

  get hives() {
    return this.items.filter((i) => i.hive)
  }

  /**
   * Ground the decorator may not use, set by the game once the farm exists.
   *
   * Placeables cannot reach the Farm directly — the Farm already imports from
   * here — so the rule arrives as a predicate instead of an import. It is what
   * keeps a lamp post out of a bed of ripening melons.
   */
  private reserved: ((x: number, z: number) => boolean) | null = null

  setReservedGround(fn: (x: number, z: number) => boolean) {
    this.reserved = fn
  }

  /**
   * Can something be dropped here?
   *
   * Rejects unwalkable ground, farmland, and anything too close to an existing
   * item — so a player cannot stack twenty benches in one spot, strand one
   * in a lake, or bury a planted crop under a flower bed. Placement was
   * previously blind to the farm entirely, which meant the tidiest-looking spot
   * on the map (a planted plot) was also a legal one.
   */
  canPlace(def: PlaceableDef, x: number, z: number) {
    if (!isWalkable(x, z)) return false
    if (this.reserved?.(x, z)) return false
    const minGap = Math.max(0.55, def.radius + 0.35)
    for (const item of this.items) {
      if (Math.hypot(item.x - x, item.z - z) < minGap) return false
    }
    return true
  }

  place(def: PlaceableDef, x: number, z: number, rotation = 0) {
    if (!this.canPlace(def, x, z)) return false

    const built = def.build()
    const isHive = 'update' in built && 'object' in built
    const object = isHive ? (built as BeehiveModel).object : (built as THREE.Object3D)

    object.position.set(x, groundHeight(x, z), z)
    object.rotation.y = rotation
    // Decoration is visual filler, so it renders on the minor layer and is the
    // first thing dropped when the renderer is under pressure.
    if (def.category === 'decor') setLayer(object, MINOR_LAYER)
    this.group.add(object)

    this.items.push({
      def,
      object,
      hive: isHive ? (built as BeehiveModel) : null,
      x,
      z,
      rotation,
      honey: 0,
    })
    this.emit()
    return true
  }

  /** Nearest item within `maxDist`, for pick-up and hive collection. */
  nearest(x: number, z: number, maxDist = 1.4) {
    let best: Placed | null = null
    let bestDist = maxDist
    for (const item of this.items) {
      const d = Math.hypot(item.x - x, item.z - z)
      if (d < bestDist) {
        best = item
        bestDist = d
      }
    }
    return best
  }

  remove(item: Placed) {
    const index = this.items.indexOf(item)
    if (index < 0) return null
    this.items.splice(index, 1)
    this.group.remove(item.object)
    disposeTree(item.object)
    this.emit()
    return item.def
  }

  /** A hive is ready when it is completely full. */
  readyHives() {
    return this.items.filter((i) => i.hive && i.honey >= 1)
  }

  collectHoney(item: Placed) {
    if (!item.hive || item.honey < 1) return 0
    item.honey = 0
    this.emit()
    return 1
  }

  /**
   * Is this tile within range of a hive? Feeds the Pollinated mutation.
   */
  isPollinated(x: number, z: number) {
    for (const item of this.items) {
      if (!item.hive) continue
      if (Math.hypot(item.x - x, item.z - z) <= HIVE_RADIUS) return true
    }
    return false
  }

  /**
   * Advance hives.
   *
   * Honey accrues faster the more planted crops sit inside the hive's radius,
   * which is the whole point of the system — a hive dropped in an empty field
   * is nearly worthless, one surrounded by a flowering farm is not.
   */
  update(dt: number, elapsed: number, farm: Farm) {
    for (const item of this.items) {
      if (!item.hive) continue
      item.hive.update(elapsed)
      if (item.honey >= 1) continue

      const nearby = countCropsNear(farm, item.x, item.z, HIVE_RADIUS)
      // Flat floor so a hive always ticks, plus a bonus that saturates.
      const rate = (0.35 + Math.min(1, nearby / 12)) / HIVE_BASE_SECONDS
      item.honey = Math.min(1, item.honey + rate * dt)
    }
  }

  /** Hives keep working while the tab is closed. */
  advanceOffline(seconds: number, farm: Farm) {
    this.update(seconds, 0, farm)
  }

  serialize() {
    return this.items.map((i) => ({
      d: i.def.id,
      x: +i.x.toFixed(2),
      z: +i.z.toFixed(2),
      r: +i.rotation.toFixed(3),
      h: +i.honey.toFixed(3),
    }))
  }

  deserialize(data: ReturnType<Placeables['serialize']> | undefined) {
    if (!Array.isArray(data)) return
    for (const entry of data) {
      const def = PLACEABLE_BY_ID.get(entry.d)
      if (!def) continue
      if (!Number.isFinite(entry.x) || !Number.isFinite(entry.z)) continue

      // Bypass canPlace: the world may have shifted slightly between versions
      // and refusing to restore would silently delete the player's decorating.
      const built = def.build()
      const isHive = 'update' in built && 'object' in built
      const object = isHive ? (built as BeehiveModel).object : (built as THREE.Object3D)
      object.position.set(entry.x, groundHeight(entry.x, entry.z), entry.z)
      object.rotation.y = entry.r ?? 0
      if (def.category === 'decor') setLayer(object, MINOR_LAYER)
      this.group.add(object)

      this.items.push({
        def,
        object,
        hive: isHive ? (built as BeehiveModel) : null,
        x: entry.x,
        z: entry.z,
        rotation: entry.r ?? 0,
        honey: Number.isFinite(entry.h) ? Math.min(1, Math.max(0, entry.h)) : 0,
      })
    }
    this.emit()
  }

  /** Wipe everything — used when the farm is retired. */
  clear() {
    for (const item of [...this.items]) this.remove(item)
  }
}

function countCropsNear(farm: Farm, x: number, z: number, radius: number) {
  let n = 0
  for (const tile of farm.tiles as Tile[]) {
    if (!tile.crop) continue
    if (Math.hypot(tile.pos.x - x, tile.pos.z - z) <= radius) n++
  }
  return n
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.geometry.dispose()
  })
}

/**
 * The decorator's preview: the actual item, standing where it would stand.
 *
 * A flat coloured quad answered "is this square legal" — but the questions a
 * player decorating actually has are "how big is this" and "which way will it
 * face", and a square answers neither. Showing the model itself answers all
 * three at once, and the tint keeps the legality read that the quad had.
 *
 * The models are cloned once per kind and kept. Building a lamp post every frame
 * the cursor moves is a mesh, a material and two textures per frame; the whole
 * catalogue held resident is seven objects.
 */
export class DecorGhost {
  readonly group = new THREE.Group()
  private readonly built = new Map<string, THREE.Object3D>()
  private shown: THREE.Object3D | null = null

  /*
   * One material for the whole preview, swapped between two colours.
   *
   * Tinting each model's own materials would mean cloning and restoring them per
   * frame, and the authored props carry textures that a tint multiplies rather
   * than replaces — a green wash over a brown bench reads as a dirty bench, not
   * as a preview. A flat unlit silhouette is unambiguous, and it is one upload.
   */
  private readonly okMaterial = new THREE.MeshBasicMaterial({
    color: 0x6ee06e,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })

  private readonly badMaterial = new THREE.MeshBasicMaterial({
    color: 0xe86a5c,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  })

  constructor() {
    this.group.visible = false
    // Above the world it previews, and never culled by the crop it hovers over.
    this.group.renderOrder = 4
  }

  private modelFor(def: PlaceableDef) {
    const cached = this.built.get(def.id)
    if (cached) return cached

    const raw = def.build()
    // A hive builds as { object, update }; everything else is the object itself.
    const object = ('object' in raw ? raw.object : raw) as THREE.Object3D
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.material = this.okMaterial
      mesh.castShadow = false
      mesh.receiveShadow = false
    })
    setLayer(object, MINOR_LAYER)
    this.built.set(def.id, object)
    this.group.add(object)
    object.visible = false
    return object
  }

  /** Stand the preview at a spot. `valid` picks the tint. */
  show(def: PlaceableDef, x: number, z: number, rotation: number, valid: boolean) {
    const object = this.modelFor(def)
    if (this.shown && this.shown !== object) this.shown.visible = false
    this.shown = object

    object.visible = true
    object.position.set(x, groundHeight(x, z), z)
    object.rotation.y = rotation
    const material = valid ? this.okMaterial : this.badMaterial
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) mesh.material = material
    })
    this.group.visible = true
  }

  hide() {
    this.group.visible = false
    if (this.shown) this.shown.visible = false
    this.shown = null
  }
}

export type { Placed }
