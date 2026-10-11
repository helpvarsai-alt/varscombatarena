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

Each file contains a 41-bone humanoid skeleton and 76 named animation clips.
Every prop variant in the pack (five Knight shields, both axes, mug, hats,
capes) ships as a live node inside each character, so the per-fighter loadout in
`src/game/models.ts` explicitly hides the props it does not use.

`src/game/model-manifest.json` is generated from the binaries by
`bun run manifest:models` and records the measured facts `src/game/models.ts`
relies on — clip names and durations, body height, feet height, facing axis and
root-motion range. Regenerate it if the model files are ever replaced.

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
