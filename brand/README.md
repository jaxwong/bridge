# BRIDGE brand assets

For slides and anything else outside the product. The app does not load these files — it
draws the mark inline, so nothing here is on a code path. Regenerate them if the mark
changes (see the bottom of this file).

## The mark

Two towers, a cable slung between them, a deck across. Four strokes, which is about all
that survives at 20px.

## Files

| File | Use |
|---|---|
| `bridge-lockup-light.png` | Mark + wordmark, **dark text** — for light slides. 611 × 200 |
| `bridge-lockup-dark.png` | Mark + wordmark, **white text** — for dark slides. 611 × 200 |
| `bridge-mark-256.png` · `-512` · `-1024` | The mark alone on its indigo tile, square |
| `bridge-glyph-white-512.png` | The glyph alone, white, no tile — for placing on a colour |
| `bridge-mark.svg` | Vector source: tile + glyph. Scales to any size |
| `bridge-mark-mono.svg` | Vector, glyph only, `currentColor` — set your own colour |

Every PNG has a **transparent background**, so the lockups drop onto any slide colour. The
dark lockup is white text: it will look blank in a file preview on white, which is correct.

Prefer the SVG wherever the tool accepts it — it stays sharp at any size. Use the PNGs for
Keynote, PowerPoint and Google Slides, which handle SVG unevenly.

## Colour

The tile is `#4f46e5`, the same indigo the product uses for its primary action. On a
coloured or photographic background use `bridge-glyph-white-512.png` rather than the tile.

## Regenerating

The PNGs were rendered from `bridge-mark.svg` with headless Chromium at 1× (the lockups
include live text, so they are screenshots of the real typeface rather than traced
outlines). If you change the mark, edit the SVG first and re-render from it, so the vector
stays the source of truth.
