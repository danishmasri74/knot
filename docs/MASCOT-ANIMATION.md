# Mascot animation assets

The three approved drawings remain in `public/mascot/*-approved.png`. The animations use whole clean body layers (`library-backing.png`, `search-backing.png`, `ask-backing.png`) with separate original prop and eye pixels. Avoid rectangular cover patches: they create seams when a prop moves.

`src/app/mascot-parts.ts` contains clip contours traced from the approved raster outlines. `Mascot.tsx` composes the layers; `src/styles/mascot.css` supplies independent prop actions, eye tracking, blinking, and reduced-motion fallback. The Library's stationary notebook occludes the page's completed lower-left corner. Ask Knot reuses `writing-pencil.webp` rather than a second pencil design. The original writing eyes are individually scaled 2.3× about their existing centers, retaining their blink.

## Asset provenance

The body layers were prepared with the built-in image generation tool, using the existing approved images as edit targets; no CLI/API fallback was used. Original raster props are clipped at their contours so surrounding body pixels do not travel with them. Intermediate generated images remain in the Codex generated-images folder.

## Body preparation prompts

### library

```
Use case: precise-object-edit. This is an INTERNAL animation backing plate, not a new character design. Edit the attached mascot image in place. Preserve the original square canvas, exact character position, size, folded corner, outline, feet, eyes, mouth, K mark, color and subtle paper shading. Do NOT resize, recenter, restyle, or change the silhouette. Transparent background must remain transparent. Restore only the pixels hidden by the objects specified below; everything else is unchanged. Reconstruct smooth continuous pale paper body where removed objects formerly covered it. No new props, limbs, captions or changes to facial features.
Remove ONLY the large loose page being held in front of the body AND the two round hands holding that page. Restore uninterrupted pale body behind them. KEEP the small blue closed spiral-bound notebook at the lower-left entirely unchanged. KEEP all exterior body edges and both feet unchanged.
```

### search

```
Use case: precise-object-edit. This is an INTERNAL animation backing plate, not a new character design. Edit the attached mascot image in place. Preserve the original square canvas, exact character position, size, folded corner, outline, feet, eyes, mouth, K mark, color and subtle paper shading. Do NOT resize, recenter, restyle, or change the silhouette. Transparent background must remain transparent. Restore only the pixels hidden by the objects specified below; everything else is unchanged. Reconstruct smooth continuous pale paper body where removed objects formerly covered it. No new props, limbs, captions or changes to facial features.
Remove ONLY the magnifying glass (lens, rim, shaft, handle) and its circular holding hand on the LEFT side of the picture. Inpaint the continuous original paper body behind them with its smooth dark LEFT edge, continuing naturally from above the glass down to the bottom-left corner. Outside that body edge should be fully transparent. Keep the other hand on the RIGHT, the face, and the remainder of the body unchanged.
```

### ask

```
Use case: precise-object-edit. This is an INTERNAL animation backing plate, not a new character design. Edit the attached mascot image in place. Preserve the original square canvas, exact character position, size, folded corner, outline, feet, eyes, mouth, K mark, color and subtle paper shading. Do NOT resize, recenter, restyle, or change the silhouette. Transparent background must remain transparent. Restore only the pixels hidden by the objects specified below; everything else is unchanged. Reconstruct smooth continuous pale paper body where removed objects formerly covered it. No new props, limbs, captions or changes to facial features.
Remove ONLY the yellow pencil and the round hand holding that pencil on the LEFT side of the picture. Restore the pale body behind them. Where the pencil tip and hand overlapped the open notebook, restore the notebook's continuous black top edge and blank cream page. KEEP the entire open notebook, blue cover, RIGHT round hand, face and body silhouette unchanged. Do not add a replacement pencil: this plate will sit behind a separately animated pencil.
```

## Final eye-removal pass

Applied separately to each prepared body layer:

```
Use case: precise-object-edit. Internal animation body layer. Edit this exact image in place: remove ONLY the TWO BLACK DOT EYES, replacing each with seamless matching pale paper body shading. Keep the mouth/smile, all body contours, folded corner, K mark, feet, remaining hand and any notebook exactly unchanged. Do not add any props, hands, limbs or facial features. Do not resize, recenter, change proportions, shading, colors, or outline. Keep the full original square canvas and the exact drawing registration. Preserve genuine background transparency. The two eye positions should be completely blank paper with no marks, no eye sockets, no blurred squares or circles. This is an eyeless body layer for compositing the original eyes back as separately animated layers.
```

## Verification

Run `pnpm dev`, then `node tests/mascot-animation.browser.mjs`. It checks independent prop movement with stationary bodies, simultaneous instances, unique clip IDs, image loading, reduced motion, and captures rest, motion extremes and blinking in light and dark backgrounds under `test-results/mascot-rigs`. Inspect those frames as well as the recorded motion before shipping.
