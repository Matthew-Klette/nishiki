# Nishiki

A field guide to eight koi varieties, drawn live in code. Portfolio project #2 by Matt Klette.
**Concept work:** Nishiki is a fictional publisher; there is no company, shop or product behind it.

## Run

```bash
npm install
npm run dev        # http://localhost:4318
npm run build      # subsets the Japanese font, typechecks, builds to dist/
npm run preview    # serves dist/ on http://localhost:4319
npm test           # Vitest: geometry, patterns, swimming, quiz, pond, WCAG token contrast
npm run lint       # oxlint, warnings fail
```

## What's in it

| Section | Interaction |
|:--|:--|
| Hero | A procedural Kohaku swims a figure-of-eight through the word NISHIKI (vertical 錦鯉 on phones), passing in front of some letters and behind others. Follows the cursor; tap the water to feed her. |
| The varieties | A locked-off, spotlit stage: one fish re-patterns in place across eight varieties, with a cross-dissolve and a pausable parade. |
| Reading a koi | A Shōwa specimen with seven numbered points (hi, sumi, shiroji, kiwa, sashi, menware, motoguro). |
| Name that koi | Six rounds; every fish is a fresh procedural pattern; distractors are the varieties people confuse. |
| The pond | Six koi wander under lily pads; taps scatter food and the nearest fish come to eat. |

## How it works

- `src/lib/`: pure logic (seeded RNG, geometry, body profile, koi locomotion and swimming, roaming, variety patterns, quiz, pond). Unit tested in `tests/`.
- `src/render/koi.ts`: Canvas 2D renderer. The body is posed from the fish's heading and C-bend (not a trail), with a travelling wave laid on top; the swimming is built from fish-locomotion research (see `docs/koi-motion.md`). Patterns are mapped in body coordinates so they bend with the fish. Depth through the type is whole letters layered in front of or behind the fish canvas.
- Every canvas renders at full `devicePixelRatio`; loops pause off-screen and in hidden tabs; `prefers-reduced-motion` draws still poses.
- `scripts/subset-jp-fonts.mjs` keeps only the Zen Kaku Gothic New slices that cover characters used in `src/` (CSS 298 kB → 46 kB).
- `scripts/overflow-audit.js`: paste into the console, run `await auditOverflow()`; every width should report `clean`.

Type: Bricolage Grotesque, Zen Kaku Gothic New, IBM Plex Mono (SIL OFL). No images: every fish is code.
