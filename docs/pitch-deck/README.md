# Finals pitch deck

17-slide deck for the GDG Agent Wars finals (about 5–7 minutes, with the 3-minute live demo at slide 5).

## Present it

Open `index.html` in a browser (no build, no server needed; fonts load from Google Fonts when online).

| Key | Action |
|---|---|
| `→` / `Space` / click right half | Next slide |
| `←` / click left half | Previous slide |
| `N` | Toggle speaker notes |
| `F` | Fullscreen |
| `Home` / `End` | First / last slide |

Link to a slide directly with its id, for example `index.html#healing`.

## Files

- `slides/<id>.html`: one 1920×1080 slide each, with speaker notes in its `<aside>`
- `deck.json`: slide order, sections and typefaces
- `index.html`: standalone viewer assembled from the two above

## Before presenting

- Fill in the bracketed results on slide 14 (`slides/evaluation.html`) from the latest `make eval` run.
- Fill in `[Team name]` on the closing slide and check the member names.
- Slides 13–14 describe the PII guardrails and the agent evaluation suite. Merge those features before the finals so the demo matches the deck.
