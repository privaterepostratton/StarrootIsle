/**
 * The editor's own stylesheet, as a string.
 *
 * Inlined rather than kept in styles.css because the editor is dynamically
 * imported and must not exist at all in a player's build — a CSS file the game
 * always links would defeat that, and would also put editor class names one typo
 * away from colliding with game ones. Every selector here is prefixed `sv-e-`
 * for the same reason.
 *
 * Deliberately styled as a tool: dark, tight, cyan. It should never be mistaken
 * for a screen a player can reach.
 */
export const EDITOR_CSS = `
/*
 * No transitions on the widgets being laid out.
 *
 * Half the HUD transitions "transform" for its hover and press feel, and this
 * system positions with the same property — so every commit animated over ~150ms
 * instead of applying. That makes the tool lie twice over: the gizmo reads the
 * element's box each frame and would trail the drag by the transition's
 * duration, and any measurement taken right after a commit reads a value the
 * layout is only passing through. Suppressed rather than worked around, because
 * an editor's whole contract is that the screen shows the value you set.
 *
 * Scoped to the editing session, so the game's own feel is untouched, and to
 * transitions only — keyframe animations (the idle portrait, the coin pulse) are
 * content and keep running.
 */
body.sv-ui-editing #ui,
body.sv-ui-editing #ui * {
  transition: none !important;
}

.sv-e-root {
  position: fixed;
  inset: 0;
  z-index: 9000;
  pointer-events: none;
  font: 12px/1.45 'Fredoka', system-ui, sans-serif;
  color: #d8e2ea;
  -webkit-font-smoothing: antialiased;
}
.sv-e-root * { box-sizing: border-box; }

/* Full-screen catcher for hover + click selection. */
.sv-e-pick {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  cursor: crosshair;
}

/* Hover and selection outlines. */
.sv-e-hover, .sv-e-sel {
  position: absolute;
  pointer-events: none;
}
.sv-e-hover {
  outline: 1px dashed #4ad0ff;
  background: rgba(74, 208, 255, 0.07);
}
.sv-e-sel { outline: 1px solid #ffb43a; }
.sv-e-hover-tag {
  position: absolute;
  left: 0;
  bottom: 100%;
  transform: translateY(-2px);
  background: #4ad0ff;
  color: #0b1016;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  font-size: 10px;
}

/* ---- selection gizmo ---- */
.sv-e-move {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  cursor: move;
}
.sv-e-h {
  position: absolute;
  width: 11px;
  height: 11px;
  margin: -6px 0 0 -6px;
  background: #ffb43a;
  border: 1px solid #2a1c06;
  border-radius: 2px;
  pointer-events: auto;
}
.sv-e-h[data-h="n"], .sv-e-h[data-h="s"] { cursor: ns-resize; }
.sv-e-h[data-h="w"], .sv-e-h[data-h="e"] { cursor: ew-resize; }
.sv-e-h[data-h="nw"], .sv-e-h[data-h="se"] { cursor: nwse-resize; }
.sv-e-h[data-h="ne"], .sv-e-h[data-h="sw"] { cursor: nesw-resize; }

/* Pivot: a ring, because it marks a point rather than an edge. */
.sv-e-pivot {
  position: absolute;
  width: 15px;
  height: 15px;
  margin: -8px 0 0 -8px;
  border: 2px solid #63e6a0;
  border-radius: 50%;
  background: rgba(10, 20, 14, 0.5);
  pointer-events: auto;
  cursor: grab;
}
.sv-e-pivot::after {
  content: '';
  position: absolute;
  inset: 5px;
  background: #63e6a0;
  border-radius: 50%;
}

/* Anchor markers, drawn in the parent's space like Unity's four arrowheads. */
.sv-e-anchor {
  position: absolute;
  width: 0;
  height: 0;
  border: 7px solid transparent;
  pointer-events: auto;
  cursor: grab;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.7));
}
.sv-e-anchor[data-c="nw"] { border-top-color: #ff5ec7; border-left-color: #ff5ec7; margin: -1px 0 0 -1px; }
.sv-e-anchor[data-c="ne"] { border-top-color: #ff5ec7; border-right-color: #ff5ec7; margin: -1px 0 0 -13px; }
.sv-e-anchor[data-c="sw"] { border-bottom-color: #ff5ec7; border-left-color: #ff5ec7; margin: -13px 0 0 -1px; }
.sv-e-anchor[data-c="se"] { border-bottom-color: #ff5ec7; border-right-color: #ff5ec7; margin: -13px 0 0 -13px; }
.sv-e-anchor-rect {
  position: absolute;
  pointer-events: none;
  outline: 1px dashed rgba(255, 94, 199, 0.55);
}

/*
 * Pick menu — every element under the cursor, listed.
 *
 * Clicking used to select the outermost candidate and cycle inward on repeat
 * clicks, which is unusable once a full-screen container is in the stack: the
 * shop overlay or #ui itself would eat the first click every time, and finding a
 * button inside meant clicking blind and watching the title change. Listing the
 * stack makes the choice explicit and one click long.
 */
.sv-e-menu {
  position: absolute;
  z-index: 2;
  min-width: 210px;
  max-width: 340px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 4px;
  background: rgba(18, 23, 30, 0.97);
  backdrop-filter: blur(8px);
  border: 1px solid #35506c;
  border-radius: 7px;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}
.sv-e-menu-head {
  font: 10px/1.5 Consolas, monospace;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.45;
  padding: 2px 7px 5px;
}
.sv-e-menu button {
  display: block;
  width: 100%;
  text-align: left;
  font: 11px/1.45 Consolas, monospace;
  background: none;
  border: none;
  border-radius: 4px;
  padding: 3px 7px;
  margin: 0;
  color: #d8e2ea;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sv-e-menu button:hover { background: #27405c; color: #fff; }
/* The deepest candidate is listed first — it is nearly always the intended one. */
.sv-e-menu button.sv-e-first { color: #ffb43a; }
.sv-e-menu button .sv-e-dim { opacity: 0.45; }
/* Marks a candidate that covers most of the screen, i.e. a container not a widget. */
.sv-e-menu button .sv-e-full { color: #4ad0ff; opacity: 0.75; }

/* Snap guides. */
.sv-e-guide {
  position: absolute;
  background: #ff5ec7;
  pointer-events: none;
  opacity: 0.9;
}
.sv-e-guide.v { width: 1px; }
.sv-e-guide.h { height: 1px; }

/* Live readout that follows a drag. */
.sv-e-tip {
  position: absolute;
  pointer-events: none;
  background: #0b1016;
  border: 1px solid #3a5b80;
  border-radius: 4px;
  padding: 2px 6px;
  font: 11px/1.3 Consolas, monospace;
  color: #a8e6a0;
  white-space: pre;
}

/* ---- chrome ---- */
/*
 * The chrome is translucent, dockable and hideable, because it sits on top of the
 * very thing it edits.
 *
 * The panel occupies the right edge and the bar the top — which is precisely
 * where right-anchored and top-anchored HUD lives, so the first widget you try to
 * lay out is the one you cannot see. Shifting the game UI out from under it was
 * the tempting fix and the wrong one: it would change the geometry being
 * measured, and a layout tool that moves your layout to show you your layout is
 * worthless. Getting out of the way instead — see-through, swap sides, or Tab to
 * hide entirely — leaves the measurements honest.
 */
.sv-e-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: rgba(16, 21, 28, 0.86);
  backdrop-filter: blur(7px);
  border-bottom: 1px solid #2b3542;
  pointer-events: auto;
  /*
   * One line, always. The bar has a fixed 34px height, so anything that wraps
   * spills over its own background and sits on top of the HUD it is meant to be
   * above — which is what the hint text did once the name dropdown took up room.
   */
  flex-wrap: nowrap;
  overflow: hidden;
}

.sv-e-bar .sv-e-hintbar {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.sv-e-bar b { color: #4ad0ff; letter-spacing: 0.06em; text-transform: uppercase; font-size: 11px; }
.sv-e-bar .sv-e-spacer { flex: 1; }
.sv-e-bar .sv-e-status { font: 11px Consolas, monospace; opacity: 0.7; }

/*
 * The name dropdown. Monospace so the leading indent actually lines up into a
 * tree, and width-capped so a long entry cannot push the Save button off the bar.
 */
.sv-e-picker {
  font: 11px/1.3 Consolas, monospace !important;
  max-width: 260px;
  flex: 0 1 auto;
}
.sv-e-bar .sv-e-hintbar { font: 11px Consolas, monospace; opacity: 0.4; }

.sv-e-panel {
  position: absolute;
  top: 42px;
  right: 8px;
  width: 296px;
  max-height: calc(100vh - 52px);
  overflow-y: auto;
  background: rgba(22, 27, 35, 0.94);
  backdrop-filter: blur(7px);
  border: 1px solid #2b3542;
  border-radius: 7px;
  padding: 10px;
  pointer-events: auto;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}

/* Docked left instead, for laying out the right edge of the screen. */
.sv-e-root.sv-e-dock-left .sv-e-panel {
  right: auto;
  left: 8px;
}

/* Tab hides the chrome but keeps the selection, gizmo and guides live. */
.sv-e-root.sv-e-bare .sv-e-bar,
.sv-e-root.sv-e-bare .sv-e-panel {
  display: none;
}

/*
 * Minimised: the bar collapses to a corner handle.
 *
 * It stops spanning the full width, which is the whole point — the top row of the
 * HUD is resource pills and the gear button, and they cannot be laid out from
 * underneath a 34px strip. Everything except the elements marked sv-e-keep is
 * dropped, leaving the restore arrow and the status line so unsaved work is still
 * visible. The panel is untouched; use the dock toggle or Tab for that.
 */
.sv-e-root.sv-e-min .sv-e-bar {
  right: auto;
  width: auto;
  height: 22px;
  gap: 7px;
  padding: 0 8px 0 4px;
  border-right: 1px solid #2b3542;
  border-bottom-right-radius: 7px;
}

.sv-e-root.sv-e-min .sv-e-bar > *:not(.sv-e-keep) {
  display: none;
}

.sv-e-root.sv-e-min .sv-e-bar button.sv-e-keep {
  padding: 1px 6px;
  line-height: 1;
}
.sv-e-panel h3 {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.5;
  margin: 12px 0 6px;
  font-weight: 600;
}
.sv-e-panel h3:first-child { margin-top: 0; }
.sv-e-title {
  font-size: 13px;
  font-weight: 600;
  color: #ffb43a;
  word-break: break-all;
}

.sv-e-row { display: grid; grid-template-columns: 46px 1fr 1fr; gap: 5px; align-items: center; margin-bottom: 4px; }
.sv-e-row > span:first-child { opacity: 0.55; font-size: 11px; }
.sv-e-root input[type=text],
.sv-e-root input[type=number],
.sv-e-root select {
  font: 11px/1.3 Consolas, monospace;
  width: 100%;
  min-width: 0;
  background: #0d1218;
  color: #d8e2ea;
  border: 1px solid #2f3b4a;
  border-radius: 3px;
  padding: 3px 5px;
}
.sv-e-root input:focus, .sv-e-root select:focus { outline: 1px solid #4ad0ff; border-color: #4ad0ff; }
.sv-e-root input[type=range] { width: 100%; }

.sv-e-root button {
  font: inherit;
  font-size: 11px;
  background: #223244;
  color: #d8e2ea;
  border: 1px solid #35506c;
  border-radius: 4px;
  padding: 4px 9px;
  cursor: pointer;
}
.sv-e-root button:hover { background: #2c425a; }
.sv-e-root button.sv-e-on { background: #1f4a5c; border-color: #4ad0ff; color: #b8ecff; }
.sv-e-root button.sv-e-save { background: #235c34; border-color: #3d8a52; }
.sv-e-root button.sv-e-save:hover { background: #2d7342; }
.sv-e-root button.sv-e-danger { background: #5c2626; border-color: #8a3d3d; }
.sv-e-root button:disabled { opacity: 0.4; cursor: default; }

/* Unity's 4x4 anchor picker. */
.sv-e-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
.sv-e-presets button {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  background: #0d1218;
  border: 1px solid #2a3542;
}
.sv-e-presets button i {
  position: absolute;
  background: #6f8ba6;
  transition: background 0.1s;
}
.sv-e-presets button:hover { border-color: #4ad0ff; }
.sv-e-presets button.sv-e-on { background: #17313d; border-color: #4ad0ff; }
.sv-e-presets button.sv-e-on i { background: #4ad0ff; }

.sv-e-flow {
  background: #402a12;
  border: 1px solid #7a5320;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.4;
  color: #ffd9a0;
  margin-bottom: 8px;
}
.sv-e-hint { font-size: 10px; opacity: 0.45; line-height: 1.4; margin-top: 4px; }
.sv-e-btns { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.sv-e-empty { opacity: 0.45; font-size: 11px; line-height: 1.5; }

/* Slice source view with grabbable guides. */
.sv-e-slice-wrap { position: relative; display: inline-block; outline: 1px solid #2f3b4a; margin-top: 4px; }
.sv-e-slice-wrap img { display: block; image-rendering: pixelated; }
.sv-e-sg { position: absolute; background: #4ad0ff; }
.sv-e-sg.h { left: 0; right: 0; height: 1px; cursor: ns-resize; }
.sv-e-sg.v { top: 0; bottom: 0; width: 1px; cursor: ew-resize; }
.sv-e-sg::after { content: ''; position: absolute; inset: -5px; }
.sv-e-sg-mid { position: absolute; background: rgba(74, 208, 255, 0.1); pointer-events: none; }

/* Hierarchy tree, with its filter box directly above. */
.sv-e-treefind { margin-bottom: 5px; }
.sv-e-tree { max-height: 210px; overflow-y: auto; margin: 0 -4px; }
.sv-e-tree div {
  padding: 2px 5px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 11px Consolas, monospace;
}
.sv-e-tree div:hover { background: #223244; }
.sv-e-tree div.sv-e-on { background: #4a3410; color: #ffb43a; }
.sv-e-tree div.sv-e-has { color: #a8e6a0; }
`
