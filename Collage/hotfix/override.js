// v10.2 hotfix scaffold — loaded only if this file exists.
// Add overrides/patches here. Examples are provided and commented out.

/* Example: make deckle/edge effects more pronounced globally
import { drawEdgeEffects } from './collage.js'; // if you exported it
window.__edgeBoost = 1.25;
*/

// Example: wrap generateCollage without touching the base file
if (!window.__hotfixWrapped) {
  window.__hotfixWrapped = true;
  const orig = window.generateCollage;
  if (typeof orig === 'function') {
    window.generateCollage = function(ctx, photos, params){
      // Example tweaks you can keep or remove:
      // Ensure strips never exceed 10% of short side already; you can clamp here again if desired.
      // params.strips.thicknessPct = Math.min(params.strips.thicknessPct, 10);

      // Slight bump to edge visibility (multipliers are gentle)
      if (params?.tiles) {
        params.tiles.edgeContrast = (params.tiles.edgeContrast ?? 0) * 1.15;
        params.tiles.deckle       = (params.tiles.deckle ?? 0) * 1.10;
      }
      const res = orig(ctx, photos, params);
      console.log('[Hotfix] generateCollage wrapped · stats:', res?.stats);
      return res;
    };
  }
  console.log('[Hotfix] scaffold active');
}
