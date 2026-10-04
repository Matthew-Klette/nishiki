# How the koi swim

The swimming in Nishiki is built from fish-locomotion research rather than eyeballed. The old
version moved like a snake: every point of the body followed the path the head had taken, and the
body showed S-curves whenever the path wandered. A fish doesn't do that. This note records what the
motion is based on and where the numbers come from. Code: `src/lib/locomotion.ts`, `src/lib/swim.ts`,
`src/lib/roam.ts`, `src/render/koiFrame.ts`.

## What separates a fish from a snake (seen from above)

1. The body is built from the fish, not from its trail: a heading plus a bend. A gliding fish is a
   straight fish.
2. The head barely moves. The side-to-side sway is small at the snout, smallest about a quarter of
   the way back, and grows toward the tail (a quadratic envelope).
3. At most one wave shows on the body (wavelength about 0.93 of the fish's length), and it runs
   backward faster than the fish moves forward (slip below 1). A snake's wave stands still on the ground.
4. Koi beat and glide: a few tail beats, then a long coast with the body straight.
5. They turn with quick C-flicks of the tail, then glide straight on the new heading; between
   strokes the pectoral fins make small corrections.
6. The front third is rigid and sets the heading; the bend lives in the back two thirds.
7. Pectoral fins do visible work: folded back in a fast glide, fanned out and sculling to hover,
   flared to brake, the inside fin flaring in a turn.

## Numbers used

| Quantity | Value in the code | Source |
|:--|:--|:--|
| Sway envelope (peak-to-peak, x = 0 snout → 1 tail tip) | 0.05 − 0.13x + 0.28x² | Di Santo et al. 2021, PNAS 118:e2113206118 (44 species, pooled) |
| Quietest point / yaw pivot | x ≈ 0.23 of the whole fish (`PIVOT_U` ≈ 0.28 of the body) | Di Santo et al. 2021 |
| Body wavelength | 0.93 fish lengths (subcarangiform median) | Di Santo et al. 2021 |
| Stride | ≈ 0.7 fish lengths per tail beat | Bainbridge 1958, J Exp Biol 35:109; Sánchez-Rodríguez et al. 2023, Nat Commun |
| Tail-beat frequency in a burst | 1.3 × (1 + speed in BL/s) Hz, 1.5–3 Hz | Extrapolated from Bainbridge 1958 and koi burst data (Wu, Yang & Zeng 2007, J Exp Biol 210:2181). Estimate. |
| Beat-and-glide | 45–75% of free-swimming time; coast longer than burst; 1 half-beat (turn flick) to 2 beats per burst | Wu, Yang & Zeng 2007, J Exp Biol 210:2181 (koi) |
| Coast deceleration | U(t) = U0 / (1 + 1.22·U0·t) | Derived from Wu et al. 2007 (koi coast drag coefficient 0.060) |
| Routine turn | C-flick of 10–35°, radius ≈ 0.3 body lengths (0.08–0.55), anterior third rigid | Wu, Yang & Zeng 2007, J Exp Biol 210:4379 (koi) |
| Amplitude vs speed | about 60% of full amplitude at 0.4 BL/s, full from 1 BL/s | Interpolated (estimate) |
| Pectoral sculling | 1.2–2.1 Hz in small fish; slower here for the long butterfly fins | Gibb et al. 1994, J Exp Biol 189:133 (proxy, bluegill) |

Values marked as estimates were not measured on carp and are flagged as such in the research notes.
The test suite (`tests/swim.test.ts`, `tests/roam.test.ts`) checks the motion against these: the
head sways under ~0.42 of the tail root, slip stays between 0.5 and 0.85, a cruising koi glides,
turns make one C and never an S, the body doesn't retrace the head's path, food at the mouth
doesn't make the fish thrash, and the roaming hero koi turns both ways at random.

## Roaming (the hero koi)

The hero koi swims legs: it turns onto a course and swims a stretch along it, then picks the next.
Which way it turns is a coin toss weighted toward alternating (fish tend to alternate turns), and
at the edge of its water it slows almost to a hover and wheels round either way before crossing
back. Choosing the next point by "the short way round" instead would make every turn at the ends of
the area go the same way: one big loop, which is what the old figure-of-eight looked like.
