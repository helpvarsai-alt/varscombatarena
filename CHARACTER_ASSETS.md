# Character assets: what exists, what it can and cannot do, and what replacing it would take

This is a proposal, not a change. Nothing in it is required for the current
roster to look correct: the work that closed the gaps reachable *without* new
files is in `src/game/models.ts`, `src/game/animation.ts`, `src/game/sim.ts` and
`src/game/render3d.ts`, and it is measured by `bun run verify:models` and
`bun run verify:anim`.

## Where the current roster stands

| Property | Value (measured, not assumed) |
| --- | --- |
| Source | KayKit Adventurers Character Pack 1.0, Kay Lousberg, **CC0 1.0** |
| Files | 5 `.glb`, 3.5–3.7 MB each, vendored unmodified |
| Skeleton | 41 bones, humanoid, no IK targets authored, `root` bone has no horizontal motion in any clip |
| Clips | 76, identical library in all five files, 0.4 s – 3.0 s each |
| Geometry | ~3,900–4,300 triangles per fighter (one draw-call atlas material) |
| Materials | one 1024² base-colour atlas per model, `roughness 0.5`, `metalness 0`, **no** normal / occlusion / emissive maps |
| Faces | 5 (Barbarian, Knight, Mage, Rogue, Rogue-hooded) for 6 fighters, so TIDE and VOLT share a mesh and are separated by loadout and costume colour |

Presented height per fighter, measured at the peak of the idle: BLAZE 161.4u,
TERRA 157.6u, NYX 147.0u, FROST 146.2u, VOLT and TIDE 145.0u — all against a
150u hitbox, so the roster varies by about 11% in height.

### What that budget already delivers

- Correct scale, floor contact and facing for all six (`verify:models`: boots
  land within 0.06u of the deck, every fighter faces +X).
- Every attack contact lands on the frame its hitbox opens, within 0.0 frames
  measured through the real mixer, for all six fighters and all 20 combos.
- Forward locomotion foot speed matches ground speed exactly (rate derived from
  the measured 1.2 model-unit stride of the run cycle); backpedal slips 1.5x
  because no run-backwards clip exists.
- Weapon-appropriate strikes: TERRA swings the sword she holds, NYX the knives,
  instead of both punching with a weapon in hand.

### What it cannot deliver, and why

1. **Cadence range.** A clip authored at ~1 step/0.55 s cannot cover 245 u/s
   backwards without either sliding or playing at 4.7x. Only new clips fix it.
2. **Ik-free weight.** There is no IK, no foot-planting curve data and no
   root-motion, so every translation is code-driven; a slide can be reduced but
   not removed at speeds far from the clip's authored pace.
3. **Skin weight and material fidelity.** One atlas with no normal/roughness
   maps means the knight's plate and the rogue's leather differ only by the
   roughness value the renderer assigns. Armour cannot read as armour.
4. **Faces and identity.** One shared mesh means two fighters can only be told
   apart by prop, costume colour and effect; there is no facial rig, no blendshapes.
5. **Proportion parity.** The pack is super-deformed (the head bone sits at ~51%
   of body height). The stand-in rig is now scaled to each model's exact height so
   the hand-off does not pop, but it is a different body plan, so the first
   second of a match still reads as a placeholder.

## Proposal A — retarget to a purpose-sized clip set (smallest useful change)

**Keep the meshes, replace the motion.**

- Clips needed: 20 attack clips sized to this game's real frame data
  (0.25–0.6 s, wind-up on frame 1–7, contact where the hitbox opens), plus a
  backdash, a proper land/stand-up pair, and hit reactions of 13/16/17 frames.
- Format: same `.glb` + glTF skinning, same 41-bone names,  in-place root, so the
  `CLIP_IMPACT` / `LOCO_CYCLE_MU` tables and the state clip map absorb it
  without a code change — drop the files in and re-run
  `bun run manifest:models` and the verifiers.
- Licensing: must be CC0 or purchased for commercial use. Budget either for a
  commissioned animator or for a paid mocap/retarget library; KayKit's own pack
  is CC0, so any derivative of it can be redistributed with the game.
- Rig compatibility: must use the pack's bone names, or ship a retarget map for
  `root / hips / spine / chest / upperarm{l,r} / lowerarm / hand / upperleg /
  lowerleg / foot / toes`.
- Performance: unchanged (same skinning cost, ~4k tris).
- Effort: 1–2 weeks of animation work plus 1 day of integration and
  re-verification. Highest value per unit of effort: it fixes the backpedal
  slip, the reaction truncation and the ultimate's phantom hits at once.

## Proposal B — replace the roster with authored characters

**New meshes, new motion, new materials.**

- Format: `.glb` with glTF 2.0 skinning, ≤ 4 bone influences, 2048² atlas with
  base-colour + normal + roughness/metallic, LOD1 at ~40% triangles.
- Skeleton: 55–70 bones with IK-friendly feet and a real facial rig if faces
  matter (they do for a 6-fighter roster).
- Rig compatibility: an explicit retarget layer, or the clip tables in
  `src/game/models.ts` re-authored per character.
- Licensing: fully commissioned or a commercial pack with named-character
  rights; CC0 options at this fidelity are scarce.
- Performance: 12k–25k triangles per fighter with 3 texture maps is 3–6x the
  current cost per fighter and 2 extra texture binds. On the low quality tier
  (`src/game/render3d.ts`, MSAA off, capped pixel ratio, no env map) this is the
  difference between a comfortable 60 fps and a marginal one on a 2020-era
  phone, so LOD1 plus the existing tier switch would be mandatory, not optional.
- Effort: 4–8 weeks with a character artist and an animator, plus a day of
  integration. This is the only route to cinematic realism.

## What was deliberately not done

- No new assets were downloaded and no roster slot was replaced: the request
  asked for improvements within the shipped set, and both proposals above need
  either money or an artist.
- The stand-in rig was **not** re-proportioned to the pack's chibi build. That
  is a large change to the rig's geometry and to every keyframe authored against
  its hip height; it is worth doing only together with Proposal B, when the
  target build is final.
