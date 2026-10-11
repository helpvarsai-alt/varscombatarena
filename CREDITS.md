# Credits

## Character models

The rigged fighters in `public/models/` come from the **KayKit Adventurers
Character Pack 1.0**.

- Author: Kay Lousberg — <https://www.kaylousberg.com>
- Licence: **CC0 1.0 Universal** (public domain dedication) — free for personal,
  educational and commercial use, attribution not required
- Source: <https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0>

Files are vendored unmodified and renamed with a `kk_` prefix:

| File | Used by | Loadout |
| --- | --- | --- |
| `kk_Barbarian.glb` | BLAZE | horned helm, bare fists |
| `kk_Mage.glb` | FROST | cape + spellbook |
| `kk_Rogue_Hooded.glb` | VOLT | hooded, caped |
| `kk_Knight.glb` | TERRA | full plate, round shield, sword |
| `kk_Rogue.glb` | NYX | twin knives |
| `kk_Rogue_Hooded.glb` | TIDE | hooded and capless, so no two fighters share a model *and* a loadout |

Each file contains a 41-bone humanoid skeleton and 76 named animation clips, and
the clip library is byte-for-byte identical across all five files. Every prop
variant in the pack (five Knight shields, both axes, mug, hats, capes) ships as
a live node inside each character, so the per-fighter loadout in
`src/game/models.ts` explicitly hides the props it does not use.

These are stylized low-poly characters — about 4,000 triangles each, one flat
texture atlas per model, no normal or emissive maps, no facial rig. They are not
photoreal and are not presented as such: what carries them on screen is the
lighting and material response, the per-fighter costume tint, the silhouette the
transform and camera give them, and the retimed animation. `CHARACTER_ASSETS.md`
records what a higher-fidelity roster would take.

`src/game/model-manifest.json` is generated from the binaries by
`bun run manifest:models` and records the measured facts `src/game/models.ts`
relies on — clip names and durations, body height, feet height, facing axis and
root-motion range. Regenerate it if the model files are ever replaced.

The two numeric tables in `src/game/models.ts` that drive animation timing are
measurable facts about these binaries, not taste, and `bun run verify:models`
re-derives both from the files on every run:

- `CLIP_IMPACT` — the fraction of each attack clip at which it extends furthest
  forward (the contact the strike is sold on).
- `LOCO_CYCLE_MU` — the ground each locomotion clip covers per cycle at rate 1,
  measured as the widest split of the two feet times two (one step is one wide
  split, a cycle is two steps). This is what turns the simulation's world speed
  into a step cadence.

## Other assets

Everything else — arena, crowd, impact FX, UI — is generated in code. The
procedural fighter rig in `src/game/render3d.ts` is the instant-load stand-in
that is shown until a skinned model arrives, and still renders the 2D mode's
opponent if the model files cannot be fetched.

The arena in `src/game/render3d.ts` is built as four depth tiers (deck, ringside,
steel bays and columns, fogged skyline) out of procedural canvas textures. Its
layout invariants — the deck top sitting on the simulation floor, the fight plane
staying clear, and no geometry ever coming between the tracking camera and a
fighter — are checked headlessly by `bun run verify:arena`.

Character direction in the same two layers is checked by the other two suites:

- `bun run verify:models` drives all six fighters through every one of the 20
  combos frame by frame and measures where each clip actually peaks against the
  frame its hitbox opens, alongside the loadout, scale, height and foot contact
  of each skinned build.
- `bun run verify:animation` measures the stand-in rig and the 2D skeleton,
  including the stride each one walks per cycle — the constants the simulation
  advances its walk phase by.
