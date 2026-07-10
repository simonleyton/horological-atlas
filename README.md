# The Horological Atlas

An interactive map of dive-watch design history, 1932–2026. A night sky in which
a watch's brightness is its historical gravity — zoom in and the stars resolve
into instrument drawings that tell the real time.

## Run

Serve the project root statically (the app fetches `data/atlas.json` over HTTP):

```sh
cd /Users/me/horological-atlas
python3 -m http.server
```

Then open <http://localhost:8000>.

## Data

- `data/watches.json` — authored watch entries.
- `data/atlas.json` — built positions. Regenerate after editing `watches.json`:

```sh
node build/layout.mjs
```

(Node ≥ 18. The app itself has zero dependencies and no build step.)

## Keys

| Key | Action |
|---|---|
| Drag / scroll | Pan / zoom to cursor |
| ⌘K or `/` | Search — watches first, then families (Enter on a family opens its index) |
| Enter / ↑ ↓ | Select result / move in results |
| Click a family label | Open the Family Index — that family's chronology in the panel |
| LENS (footer) | Attribute lenses — price band, dial color, movement, case size, origin; matches hold magnitude, the rest recede |
| Escape | Close export → lens panel → search → watch detail (→ its family, if opened from one) → family index → clear lens → return to the present → nothing |
| F or 0, double-click empty field | Fit to full extent |
| + / − | Zoom one step |
| Arrow keys | Pan |
| Space | Play / pause the century |
| H | Hide the interface (the Observatory) |
| E | Export the current view as a 2× PNG plate (year-stamped when time-scrubbed) |

## The Ephemeris

The ruler along the bottom is a time lens, not a filter: drag it (or focus it and
use ← → , Shift for decades, Home/End) and the field becomes **the sky as it
existed in that year**. Watches not yet introduced don't render; every star's
magnitude re-derives from only the descendants it had *by that year*; watches
within ~14 months of their introduction carry a brief lume ignition ring. Press
▸ (or Space) to play the whole century in ~32 seconds. Selecting a not-yet-born
watch (via search or a lineage chip) advances time to its moment.
