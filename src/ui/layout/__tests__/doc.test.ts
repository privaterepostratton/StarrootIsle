import { describe, expect, it } from 'vitest'
import {
  docToCss,
  findEntry,
  parseDoc,
  removeEntry,
  sliceCss,
  upsertEntry,
  type LayoutDoc,
  type SliceData,
} from '../doc'
import { rectFromBox } from '../rect'

const PARENT = { width: 1000, height: 600 }
const rect = () => rectFromBox({ left: 20, top: 30, width: 120, height: 40 }, PARENT)

const SLICE: SliceData = {
  src: '/ui/btn-green.png',
  t: 0,
  r: 93,
  b: 0,
  l: 93,
  bt: 0,
  br: 20,
  bb: 0,
  bl: 20,
  fill: true,
  repeat: 'stretch',
  outset: 0,
}

describe('docToCss', () => {
  it('scopes every selector under the UI root', () => {
    const css = docToCss({ version: 1, entries: [{ selector: '#topbar', rect: rect() }] })
    expect(css).toContain('#ui #topbar {')
  })

  it('scopes each half of a selector list independently', () => {
    // `#ui .chip, .tab` would leave `.tab` unscoped and losing on specificity.
    const css = docToCss({ version: 1, entries: [{ selector: '.chip, .tab', slice: SLICE }] })
    expect(css).toContain('#ui .chip, #ui .tab {')
  })

  it('emits the rect declarations', () => {
    const css = docToCss({ version: 1, entries: [{ selector: '#hotbar', rect: rect() }] })
    expect(css).toContain('position: absolute;')
    expect(css).toContain('margin: 0;')
    expect(css).toContain('width: 120px;')
  })

  it('emits border-image for a slice', () => {
    const css = docToCss({ version: 1, entries: [{ selector: '.buy', slice: SLICE }] })
    // Sheet-relative, not absolute: the compiled file lives in public/ui/, and an
    // absolute URL resolves against the host root — which is the CDN root once a
    // build is served from a subdirectory, so every piece of UI art 404s.
    expect(css).toContain("border-image: url('btn-green.png') 0 93 0 93 fill stretch;")
    expect(css).toContain('border-width: 0px 20px 0px 20px;')
    expect(css).not.toContain('border-image-outset')
  })

  it('includes outset only when non-zero', () => {
    const css = docToCss({
      version: 1,
      entries: [{ selector: '.buy', slice: { ...SLICE, outset: 4 } }],
    })
    expect(css).toContain('border-image-outset: 4px;')
  })

  it('lets the free-form css escape hatch win over the structured fields', () => {
    const css = docToCss({
      version: 1,
      entries: [{ selector: '#hotbar', rect: rect(), css: { width: '999px' } }],
    })
    // Same rule, later declaration — so the override is the effective one.
    expect(css.indexOf('width: 999px')).toBeGreaterThan(css.indexOf('position: absolute'))
    expect(css).toContain('width: 999px;')
  })

  it('skips entries with no selector and entries with nothing to say', () => {
    const css = docToCss({
      version: 1,
      entries: [
        { selector: '' },
        { selector: '#nothing' },
        { selector: '#real', rect: rect() },
      ],
    })
    expect(css).not.toContain('#nothing')
    expect(css).toContain('#ui #real')
  })

  it('preserves entry order as cascade order', () => {
    const css = docToCss({
      version: 1,
      entries: [
        { selector: '.chip', css: { color: 'red' } },
        { selector: '#coinChip', css: { color: 'blue' } },
      ],
    })
    expect(css.indexOf('.chip')).toBeLessThan(css.indexOf('#coinChip'))
  })

  it('writes the label as a comment, never as output', () => {
    const css = docToCss({
      version: 1,
      entries: [{ selector: '#hotbar', label: 'seed hotbar', rect: rect() }],
    })
    expect(css).toContain('/* seed hotbar */')
  })
})

describe('sliceCss', () => {
  it('normalises a legacy absolute src, so old layout.json files still compile', () => {
    // Documents written before the URLs were made sheet-relative stored
    // `/ui/x.png`. They are normalised on the way out rather than migrated.
    expect(sliceCss({ ...SLICE, src: '/ui/btn-green.png' })['border-image']).toBe(
      "url('btn-green.png') 0 93 0 93 fill stretch",
    )
    expect(sliceCss({ ...SLICE, src: 'ui/btn-green.png' })['border-image']).toBe(
      "url('btn-green.png') 0 93 0 93 fill stretch",
    )
  })

  it('drops fill when it is off', () => {
    expect(sliceCss({ ...SLICE, fill: false })['border-image']).toBe(
      "url('btn-green.png') 0 93 0 93 stretch",
    )
  })
})

describe('document editing', () => {
  const base: LayoutDoc = { version: 1, entries: [{ selector: '#a', label: 'A' }] }

  it('upsert replaces by selector and appends otherwise', () => {
    const replaced = upsertEntry(base, { selector: '#a', label: 'A2' })
    expect(replaced.entries).toHaveLength(1)
    expect(replaced.entries[0].label).toBe('A2')
    const added = upsertEntry(base, { selector: '#b' })
    expect(added.entries).toHaveLength(2)
  })

  it('upsert does not mutate the input', () => {
    upsertEntry(base, { selector: '#a', label: 'changed' })
    expect(base.entries[0].label).toBe('A')
  })

  it('remove and find work by selector', () => {
    expect(findEntry(base, '#a')?.label).toBe('A')
    expect(findEntry(base, '#zz')).toBeUndefined()
    expect(removeEntry(base, '#a').entries).toHaveLength(0)
  })
})

describe('parseDoc', () => {
  it('survives every shape of garbage', () => {
    for (const bad of [null, undefined, 42, 'nope', {}, { entries: 'no' }, []]) {
      expect(parseDoc(bad).entries).toEqual([])
    }
  })

  it('drops malformed entries but keeps the good ones', () => {
    const parsed = parseDoc({ version: 1, entries: [{ selector: '#ok' }, {}, null, 7] })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].selector).toBe('#ok')
  })
})
