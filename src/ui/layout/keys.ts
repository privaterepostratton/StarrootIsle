/**
 * Turning a live element into a selector that will still find it next session.
 *
 * The editor has to write something to disk, and that something has to survive
 * a reload, a rebuild of a panel's innerHTML, and the element not existing yet
 * when the stylesheet loads. A CSS selector satisfies all three — it is late-
 * binding by nature, which an object reference or a numeric index is not.
 *
 * It also quietly answers the "per-placement vs per-asset" question that dogged
 * the old 9-slice tool. The unit of styling is *whatever the selector matches*:
 * leave the derived path and you have tuned one widget; widen it to `.chip` by
 * hand and you have tuned every chip. One field, both behaviours, no second
 * data model.
 */

/** Classes that come and go at runtime, so they must never enter a key. */
const VOLATILE = new Set([
  'active',
  'hidden',
  'open',
  'closing',
  'done',
  'locked',
  'selected',
  'disabled',
  'dragging',
  'visible',
  'shown',
  'panel-open',
  'cinematic',
  'sv-ui-edit-hover',
  'sv-ui-edit-sel',
])

export const ROOT_SELECTOR = '#ui'

function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => !VOLATILE.has(c) && !c.startsWith('sv-ui-edit'))
}

/** `div.chip:nth-child(2)` — one hop of a path. */
function segment(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const cls = stableClasses(el)
  const parent = el.parentElement
  let out = tag + cls.map((c) => `.${CSS.escape(c)}`).join('')
  if (parent) {
    const sibs = Array.from(parent.children)
    // nth-child only when the tag+class alone is ambiguous. Including it
    // unconditionally would break the moment a sibling is inserted above.
    const twins = sibs.filter((s) => s.matches(out))
    if (twins.length > 1) out += `:nth-child(${sibs.indexOf(el) + 1})`
  }
  return out
}

/**
 * The most stable selector that uniquely identifies `el`.
 *
 * An id short-circuits everything — it is already unique and already immune to
 * reordering. Otherwise it walks up to the nearest id (or the UI root) and joins
 * child segments, then *verifies* the result actually resolves back to the same
 * element. Verification matters because the heuristics above are heuristics; a
 * selector that silently matches the wrong node would style the wrong widget
 * with no error anywhere.
 */
export function deriveSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.id !== 'ui') {
    parts.unshift(segment(node))
    if (node.parentElement?.id) {
      parts.unshift(`#${CSS.escape(node.parentElement.id)}`)
      break
    }
    node = node.parentElement
  }
  const selector = parts.join(' > ')
  return selector || segment(el)
}

/** Does this selector still resolve to exactly the element we derived it from? */
export function selectorMatchesUniquely(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(scoped(selector))
    return found.length === 1 && found[0] === el
  } catch {
    return false
  }
}

/**
 * Scope a stored selector for use in the generated stylesheet.
 *
 * Prefixing the UI root is what wins the specificity fight: an override of
 * `#playerCard` becomes `#ui #playerCard`, two ids against the stylesheet's one,
 * so the editor's answer beats the hand-written one without `!important`
 * anywhere. `!important` would have won too, and then nothing later could ever
 * override it — including the next thing the editor writes.
 */
export function scoped(selector: string): string {
  const s = selector.trim()
  if (!s) return s
  if (s === ROOT_SELECTOR) return s
  return s
    .split(',')
    .map((part) => `${ROOT_SELECTOR} ${part.trim()}`)
    .join(', ')
}

/** A short human label for the hierarchy and the inspector title. */
export function describeElement(el: Element): string {
  if (el.id) return `#${el.id}`
  const cls = stableClasses(el)
  if (cls.length) return `${el.tagName.toLowerCase()}.${cls[0]}`
  return el.tagName.toLowerCase()
}
