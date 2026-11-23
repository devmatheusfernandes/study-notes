/**
 * Caret/selection colours for collaborators — data handed to the
 * CollaborationCaret decorations, not component styling. Mid-lightness so
 * the caret line and its name label read on both the light and the dark
 * palette (the label text is drawn in white over the colour).
 */
const PALETTE = ["#c2410c", "#0f766e", "#7c3aed", "#be185d", "#1d4ed8", "#a16207", "#15803d", "#b91c1c"];

export function collaboratorColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
