import * as THREE from 'three'
import { CROPS, type CropDef } from './crops'
import type { WeatherType } from './weather'

/**
 * Seasons.
 *
 * A calendar layered over the existing day counter. Seasons are deliberately
 * load-bearing rather than decorative: they gate which seeds the shop will
 * stock, shift what produce is worth, bias the weather table, and recolour the
 * world. That means the same farm plays differently every few days without any
 * new content being added.
 *
 * Crops are *slowed*, never blocked, out of season — a hard block would mean a
 * player who unlocked Moonbloom in autumn simply cannot use it for a week,
 * which is a punishment rather than a decision.
 */

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter'

export interface SeasonDef {
  id: SeasonId
  name: string
  emoji: string
  /** Crop forms that thrive. Growth is faster and produce sells for more. */
  favours: CropDef['form'][]
  /** Multiplier on growth speed for favoured crops. */
  favourGrowth: number
  /** Multiplier on growth speed for everything else. */
  offGrowth: number
  /** Multiplier on sale price for favoured produce. */
  favourPrice: number
  /** Relative weather weights, multiplied into the base table. */
  weatherBias: Partial<Record<WeatherType, number>>
  /** Grass tint, blended into the terrain and vegetation. */
  grass: number
  /** Sky tint pushed into the day cycle's colours. */
  sky: number
  /** 0..1 snow coverage on high ground. */
  snow: number
}

export const SEASONS: SeasonDef[] = [
  {
    id: 'spring', name: 'Spring', emoji: '🌸',
    favours: ['bush', 'flower'],
    favourGrowth: 1.35, offGrowth: 1.0, favourPrice: 1.2,
    weatherBias: { rain: 2.2, clear: 1.0, cloudy: 1.3, fog: 1.2, storm: 0.7 },
    grass: 0x8fd85c, sky: 0xa8e0f5, snow: 0,
  },
  {
    id: 'summer', name: 'Summer', emoji: '☀️',
    favours: ['vine', 'stalk'],
    favourGrowth: 1.4, offGrowth: 1.05, favourPrice: 1.25,
    weatherBias: { clear: 2.4, storm: 1.4, rain: 0.6, fog: 0.3, cloudy: 0.8 },
    grass: 0x7ec850, sky: 0x8fd4f2, snow: 0,
  },
  {
    id: 'autumn', name: 'Autumn', emoji: '🍂',
    favours: ['root', 'tree'],
    favourGrowth: 1.35, offGrowth: 0.95, favourPrice: 1.3,
    weatherBias: { cloudy: 1.8, fog: 1.6, rain: 1.3, clear: 0.9, storm: 0.9 },
    grass: 0xb59a3c, sky: 0xf0c98c, snow: 0,
  },
  {
    id: 'winter', name: 'Winter', emoji: '❄️',
    // Nothing thrives; winter is the season you lean on greenhouses, pets and
    // stored produce rather than raw planting.
    favours: [],
    favourGrowth: 1, offGrowth: 0.7, favourPrice: 1,
    weatherBias: { fog: 2.6, cloudy: 1.8, clear: 0.9, rain: 0.5, storm: 0.4 },
    grass: 0xc8d4d8, sky: 0xcfe2ee, snow: 1,
  },
]

export const SEASON_BY_ID = new Map(SEASONS.map((s) => [s.id, s]))

/** In-game days per season. */
export const DAYS_PER_SEASON = 7

/** A full year. */
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length

export function seasonForDay(day: number): SeasonDef {
  // Day 1 is the first day of spring.
  const index = Math.floor((Math.max(1, day) - 1) / DAYS_PER_SEASON) % SEASONS.length
  return SEASONS[index]
}

export function yearForDay(day: number) {
  return Math.floor((Math.max(1, day) - 1) / DAYS_PER_YEAR) + 1
}

export function dayWithinSeason(day: number) {
  return ((Math.max(1, day) - 1) % DAYS_PER_SEASON) + 1
}

/** Growth rate multiplier this season applies to a crop. */
export function growthMultiplier(season: SeasonDef, crop: CropDef) {
  return season.favours.includes(crop.form) ? season.favourGrowth : season.offGrowth
}

/** Sale price multiplier this season applies to a crop. */
export function priceMultiplier(season: SeasonDef, crop: CropDef) {
  return season.favours.includes(crop.form) ? season.favourPrice : 1
}

/** Crops this season is good for, for the HUD and shop blurb. */
export function favouredCrops(season: SeasonDef) {
  return CROPS.filter((c) => season.favours.includes(c.form))
}

/**
 * Blend factor for the visual transition.
 *
 * Seasons cross-fade over the last day rather than snapping at midnight — a
 * world that changes colour instantly reads as a bug.
 */
export function seasonBlend(day: number, timeOfDay01: number) {
  const within = dayWithinSeason(day)
  if (within < DAYS_PER_SEASON) return { from: seasonForDay(day), to: seasonForDay(day), t: 0 }
  return {
    from: seasonForDay(day),
    to: seasonForDay(day + 1),
    t: timeOfDay01,
  }
}

const cA = new THREE.Color()
const cB = new THREE.Color()

/** Interpolated season colour, accounting for the cross-fade. */
export function blendedGrass(day: number, timeOfDay01: number) {
  const { from, to, t } = seasonBlend(day, timeOfDay01)
  cA.setHex(from.grass)
  cB.setHex(to.grass)
  return cA.lerp(cB, t)
}

export function blendedSnow(day: number, timeOfDay01: number) {
  const { from, to, t } = seasonBlend(day, timeOfDay01)
  return from.snow + (to.snow - from.snow) * t
}
