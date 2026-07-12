# The Horological Atlas

An interactive map of dive-watch design history, 1932–2026. A night sky in which
a watch's brightness is its historical gravity — zoom in and the stars resolve
into instrument drawings that tell the real time.

Two projections of the same 143 watches: **SKY** (the constellation map) and
**THE DESCENT** (a vertical helix ranked by water resistance) — toggled
top-center or with `D`. Switching morphs every star between its constellation
position and its specimen-plate card; the transition is the argument that it
is one world.

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
| Escape (sky) | Close export → lens panel → search → watch detail (→ its family, if opened from one) → family index → clear lens → return to the present → nothing |
| F or 0, double-click empty field | Fit to full extent |
| + / − | Zoom one step |
| Arrow keys | Pan |
| Space | Play / pause the century |
| D | Toggle SKY · DESCENT (also the top-center toggle); mid-morph, D or Esc reverses the flight in place |
| H | Hide the interface (the Observatory) |
| E | Export the current view as a 2× PNG plate (year-stamped when time-scrubbed; `-descent` in descent) |

### In the Descent

| Key | Action |
|---|---|
| Scroll / drag | Descend or ascend the helix — inertia coasts, then settles dead-beat on the nearest card |
| ↑ ↓ | Step one card |
| PgUp / PgDn | Jump one stratum |
| Home / End | Surface / deepest |
| Click a card | Open its detail panel (the helix flies it front-center) |
| Escape (descent) | Close lightbox → export → search → watch panel → **surface** (the reverse morph) |

## The Descent

Press `D` (or the SKY · DESCENT toggle, top-center) and the constellation
re-projects: all 143 watches on a vertical helix, ranked by water resistance,
shallow first. Depth bands (≤135 M, 150–220 M, 300 M, 500–610 M, 1000–1300 M,
2000 M+) are separated by hairline depth rulers; the footer becomes a live
depth gauge. Cards are specimen plates on one shared ground — catalog render,
else editorial photograph, else the drawn glyph. The Ephemeris and the Lens
are sky instruments and yield while below; search still works (a family result
surfaces first, since families live in the sky). The morph plays on every
toggle; under reduced motion it becomes a 200 ms cut.

## The Ephemeris

The ruler along the bottom is a time lens, not a filter: drag it (or focus it and
use ← → , Shift for decades, Home/End) and the field becomes **the sky as it
existed in that year**. Watches not yet introduced don't render; every star's
magnitude re-derives from only the descendants it had *by that year*; watches
within ~14 months of their introduction carry a brief lume ignition ring. Press
▸ (or Space) to play the whole century in ~32 seconds. Selecting a not-yet-born
watch (via search or a lineage chip) advances time to its moment.
