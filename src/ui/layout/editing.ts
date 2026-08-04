/**
 * One boolean, in its own module, so the game loop can ask whether the UI editor
 * is holding input without importing the editor.
 *
 * The editor is loaded by dynamic import specifically so its weight never
 * reaches a player's bundle. A static import from main.ts — even of a single
 * flag — would undo that by pulling the whole module graph back into the entry
 * chunk, so the flag has to live somewhere the editor also imports rather than
 * inside it.
 */

let editing = false

export function isEditingUi(): boolean {
  return editing
}

export function setEditingUi(value: boolean): void {
  editing = value
  document.body.classList.toggle('sv-ui-editing', value)
}
