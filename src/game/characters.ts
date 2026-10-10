/**
 * Roster — 6 fighters. Every character shares the exact same 20 combos and
 * frame data (pure fairness); what changes is animation flavor, aura color,
 * particle style and hit effects, which live in `CharacterTheme`.
 */

export type ParticleStyle = "ember" | "flake" | "volt" | "shard" | "shade" | "droplet";

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
  },
];

export function getCharacter(id: string): CharacterTheme {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}
