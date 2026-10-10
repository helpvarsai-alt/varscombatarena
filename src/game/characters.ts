/**
 * Roster — 6 fighters. Every character shares the exact same 20 combos and
 * frame data (pure fairness); what changes is animation flavor, body build,
 * hair/outfit, aura color, particle style and hit effects.
 *
 * `build` / `hairStyle` / `outfit` are consumed by the 3D rig so each fighter
 * reads as a clearly different person at a glance; `trim` is the secondary
 * outfit colour (belt, wraps, plating).
 */

export type ParticleStyle = "ember" | "flake" | "volt" | "shard" | "shade" | "droplet";

/** Body proportions for the 3D rig. */
export type Build = "power" | "agile" | "tank" | "slim" | "shadow" | "flow";

export type HairStyle = "spike" | "long" | "mohawk" | "buzz" | "ponytail" | "braid";

export type Outfit = "gi" | "coat" | "hoodie" | "armor" | "ninja" | "wrap";

export interface CharacterTheme {
  id: string;
  name: string;
  tagline: string;
  /** primary aura / glow */
  aura: string;
  /** secondary accent (trails, eyes) */
  accent: string;
  /** gi / suit */
  suit: string;
  /** skin tone */
  skin: string;
  /** hair */
  hair: string;
  particle: ParticleStyle;
  /** how the idle aura behaves */
  auraStyle: "flame" | "frost" | "volt" | "stone" | "void" | "tide";
  /** 3D body proportions */
  build: Build;
  hairStyle: HairStyle;
  outfit: Outfit;
  /** secondary outfit colour: belt, wraps, plating */
  trim: string;
}

export const CHARACTERS: CharacterTheme[] = [
  {
    id: "blaze",
    name: "BLAZE",
    tagline: "Ember fists, furnace heart",
    aura: "#ff6a2b",
    accent: "#ffd166",
    suit: "#d9480f",
    skin: "#f2c9a0",
    hair: "#7a2e0e",
    particle: "ember",
    auraStyle: "flame",
    build: "power",
    hairStyle: "spike",
    outfit: "gi",
    trim: "#f4ede2",
  },
  {
    id: "frost",
    name: "FROST",
    tagline: "Silence between the snowflakes",
    aura: "#63d7ff",
    accent: "#d8f6ff",
    suit: "#2b6fa8",
    skin: "#e8f0f7",
    hair: "#cfe9f7",
    particle: "flake",
    auraStyle: "frost",
    build: "slim",
    hairStyle: "long",
    outfit: "coat",
    trim: "#eaf7ff",
  },
  {
    id: "volt",
    name: "VOLT",
    tagline: "Faster than the thunder",
    aura: "#ffe24d",
    accent: "#fff7c2",
    suit: "#3a3f5c",
    skin: "#d9a36a",
    hair: "#f4e04d",
    particle: "volt",
    auraStyle: "volt",
    build: "agile",
    hairStyle: "mohawk",
    outfit: "hoodie",
    trim: "#1b1e33",
  },
  {
    id: "terra",
    name: "TERRA",
    tagline: "The mountain does not move",
    aura: "#c9a15a",
    accent: "#f3e2bf",
    suit: "#6b4f2a",
    skin: "#b98352",
    hair: "#2f2417",
    particle: "shard",
    auraStyle: "stone",
    build: "tank",
    hairStyle: "buzz",
    outfit: "armor",
    trim: "#f3e2bf",
  },
  {
    id: "nyx",
    name: "NYX",
    tagline: "You never see the shadow",
    aura: "#b06bff",
    accent: "#ff7ad9",
    suit: "#2a1b47",
    skin: "#cdb7de",
    hair: "#17102b",
    particle: "shade",
    auraStyle: "void",
    build: "shadow",
    hairStyle: "ponytail",
    outfit: "ninja",
    trim: "#ff7ad9",
  },
  {
    id: "tide",
    name: "TIDE",
    tagline: "Flow first, break later",
    aura: "#3ef0c5",
    accent: "#c8fff2",
    suit: "#0f766e",
    skin: "#e6d3b8",
    hair: "#134e4a",
    particle: "droplet",
    auraStyle: "tide",
    build: "flow",
    hairStyle: "braid",
    outfit: "wrap",
    trim: "#c8fff2",
  },
];

export function getCharacter(id: string): CharacterTheme {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** Proportions the 3D rig reads for a given build (1.0 = baseline). */
export interface Proportions {
  /** overall height multiplier (also stretches limbs) */
  height: number;
  /** shoulder / torso width multiplier */
  width: number;
  /** muscle bulge on arms & legs */
  muscle: number;
  /** head size multiplier */
  head: number;
}

export const BUILDS: Record<Build, Proportions> = {
  power: { height: 1.02, width: 1.14, muscle: 1.22, head: 0.98 },
  agile: { height: 1.0, width: 0.97, muscle: 1.02, head: 1.0 },
  tank: { height: 0.99, width: 1.3, muscle: 1.38, head: 0.96 },
  slim: { height: 1.05, width: 0.9, muscle: 0.86, head: 1.0 },
  shadow: { height: 1.02, width: 0.94, muscle: 0.94, head: 1.02 },
  flow: { height: 1.0, width: 1.0, muscle: 1.06, head: 1.0 },
};

export function getProportions(id: string): Proportions {
  return BUILDS[getCharacter(id).build];
}
