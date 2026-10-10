export type Difficulty = "easy" | "normal" | "hard";

export type GameMode = "ai" | "online";

export type Renderer2D3D = "2d" | "3d";

/** What the HUD reads every frame (written imperatively — no React churn). */
export interface HudState {
  hp1: number;
  hp2: number;
  meter1: number;
  meter2: number;
  combo1: number;
  combo2: number;
  seconds: number;
  over: boolean;
  winner: 0 | 1 | "tie" | null;
}
