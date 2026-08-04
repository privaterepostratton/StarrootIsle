/**
 * Which box-offset properties a stylesheet actually *declares* for an element.
 *
 * `getComputedStyle` cannot answer this. For an absolutely positioned box the
 * browser resolves every inset to a used pixel value, so `left` and `right` both
 * read as numbers whether the author set one, the other, or neither — and the
 * distinction is exactly what tells you a widget was designed to hug the right
 * edge rather than sit 1200px from the left.
 *
 * So this walks the CSSOM instead and asks each matching rule what it says.
 * Slower than reading computed style, but it runs once when a widget is first
 * selected, and it is the difference between the anchor picker opening on the
 * cell the author intended and opening on a cell that makes the first drag pull
 * the widget off its corner.
 */

/** Sheets whose rules describe the editor's own output, not the author's intent. */
const GENERATED = /layout\.generated\.css$/

export interface AuthoredOffsets {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
  width: boolean
  height: boolean
}

const PROPS = ['left', 'right', 'top', 'bottom', 'width', 'height'] as const

/**
 * Read the declarations that reach `el`, newest-wins per property.
 *
 * Specificity is deliberately ignored: the question is "did anyone author this
 * inset at all", and a rule that sets `right` establishes the intent whether or
 * not a more specific rule also sets `left`. Ranking them properly would need a
 * full cascade implementation to answer a question that does not depend on the
 * ranking.
 */
export function authoredOffsets(el: Element): AuthoredOffsets {
  const out: AuthoredOffsets = {
    left: false,
    right: false,
    top: false,
    bottom: false,
    width: false,
    height: false,
  }
  for (const sheet of Array.from(document.styleSheets)) {
    // A cross-origin sheet throws on access; the font stylesheet is one, and it
    // has nothing to say about layout anyway.
    let rules: CSSRuleList
    try {
      if (!sheet.cssRules) continue
      rules = sheet.cssRules
    } catch {
      continue
    }
    const own = sheet.ownerNode as Element | null
    if (own?.id === 'sv-ui-layout') continue
    if (sheet.href && GENERATED.test(sheet.href)) continue
    scan(rules, el, out)
  }
  return out
}

/**
 * Walk a rule list, recording declarations from every rule that matches.
 *
 * The instanceof order is load-bearing. Under CSS Nesting, `CSSStyleRule`
 * *inherits* from `CSSGroupingRule` and exposes a `cssRules` list — empty for an
 * ordinary rule, but an empty CSSRuleList is still a truthy object. Branching on
 * `rule.cssRules` therefore classifies every plain style rule as a group, and the
 * whole stylesheet reads as having declared nothing at all. Testing for the more
 * specific type first, and letting it *also* recurse for genuinely nested rules,
 * is the only ordering that handles both.
 */
function scan(rules: CSSRuleList, el: Element, out: AuthoredOffsets): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      let matches = false
      try {
        matches = !!rule.selectorText && el.matches(rule.selectorText)
      } catch {
        // A selector this browser cannot parse (or `&` at the top level) is not
        // worth failing the whole walk over.
        continue
      }
      if (matches) {
        for (const prop of PROPS) {
          // getPropertyValue returns '' for a property the rule does not set,
          // which is the only "was this declared" signal the CSSOM offers.
          if (rule.style.getPropertyValue(prop)) out[prop] = true
        }
      }
      // Nested rules are relative to this selector, so they only count if the
      // parent matched — otherwise `& > .x` would be read out of context.
      if (matches && rule.cssRules?.length) scan(rule.cssRules, el, out)
      continue
    }
    if (rule instanceof CSSGroupingRule) {
      // @media / @supports / @layer hold the declarations that matter for a
      // responsive HUD, so they are descended into rather than skipped. Only a
      // block that currently applies counts: a portrait-only rule is not the
      // intent for the landscape layout being edited.
      const media = (rule as CSSMediaRule).media
      if (media?.mediaText && !window.matchMedia(media.mediaText).matches) continue
      scan(rule.cssRules, el, out)
    }
  }
}
