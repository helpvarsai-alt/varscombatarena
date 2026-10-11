import { motion } from "framer-motion";
import { useMutation } from "convex/react";
import { Dices, Gamepad2, Globe2, Loader2, Swords, Users } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHARACTERS, getCharacter } from "@/game/characters";
import { rigProportionsFor } from "@/game/models";
import { getPlayerId, getPlayerName, setPlayerName } from "@/game/player";
import type { Difficulty } from "@/game/types";
import * as THREE from "three";
import { buildFighterRig, applyRigPose } from "@/game/render3d";
import { baseStance as baseStanceA, rigPoseFor as rigPoseForA } from "@/game/animation";



import type { Pose3 } from "@/game/animation";
import type { Fighter } from "@/game/sim";

type Disposable = { dispose(): void };

/** Pre-fight lobby: pick a fighter, then go 1v1 vs the CPU or open a room code
 *  a friend can join from anywhere on Earth. No sign-in — identity is the
 *  device id + the 5-character room code.
 * On first load the roster and the VS CPU section should be visible, same as
 * the audited screenshot.
 */
export default function Play() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"cpu" | "online">("cpu");
  const [charId, setCharId] = useState("blaze");
  const [name, setName] = useState(getPlayerName());
  const [diff, setDiff] = useState<Difficulty>("normal");
  const [foeId, setFoeId] = useState("frost");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);

  const foes = useMemo(() => CHARACTERS.filter((c) => c.id !== charId), [charId]);

  const saveName = (v: string) => {
    setName(v);
    setPlayerName(v);
  };

  const randomFoe = () => {
    const pool = foes.filter((c) => c.id !== foeId);
    const next = pool[Math.floor(Math.random() * pool.length)] ?? foes[0];
    setFoeId(next.id);
  };

  const launchCpu = () => {
    saveName(name);
    navigate(`/match/ai?char=${charId}&foe=${foeId}&diff=${diff}`);
  };

  const onCreate = async () => {
    setBusy(true);
    setError("");
    try {
      saveName(name);
      const { code } = await createRoom({
        playerId: getPlayerId(),
        name: name || "Fighter",
        char: charId,
      });
      navigate(`/match/${code}?char=${charId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a room.");
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError("Enter the 5-character room code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      saveName(name);
      await joinRoom({
        code,
        playerId: getPlayerId(),
        name: name || "Fighter",
        char: charId,
      });
      navigate(`/match/${code}?char=${charId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join that room.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#070a18] text-white">
      {/* friendly name field sits inside the cockpit, not the chrome */}
      <div className="mx-auto max-w-md px-4 pt-6">
        <label htmlFor="player-name" className="text-xs font-bold tracking-[0.2em] text-white/35">
          FIGHTER NAME
        </label>
        <Input
          id="player-name"
          value={name}
          onChange={(e) => saveName(e.target.value)}
          maxLength={20}
          className="mt-2 w-full border-white/15 bg-white/5 text-white placeholder:text-white/30"
          placeholder="Who's fighting?"
        />
        <p className="mt-1.5 text-[11px] leading-normal text-white/30">
          No account — this is just how your friends see you on the rooftop.
        </p>
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4">
        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-black tracking-tight sm:text-5xl"
        >
          CHOOSE YOUR <span className="text-[#ff4f6b]">FIGHTER</span>
        </motion.h1>
        <p className="mt-2 text-sm text-white/50">
          6 fighters · the same 20 combos for everyone · your skill makes the difference.
        </p>

        {/* roster */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CHARACTERS.map((c, i) => {
            const active = c.id === charId;
            return (
              <motion.button
                key={c.id}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => {
                  setCharId(c.id);
                  if (foeId === c.id) randomFoe();
                }}
                className={`group relative overflow-hidden rounded-xl border p-4 text-left transition-all ${
                  active
                    ? "border-transparent shadow-lg"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25"
                }`}
                style={
                  active
                    ? {
                        boxShadow: `0 0 0 2px ${c.aura}, 0 12px 40px -12px ${c.aura}`,
                        background: `rgba(255,255,255,0.02)`,
                      }
                    : undefined
                }
              >
                <div className="relative overflow-hidden rounded-lg bg-[#080b18] aspect-[4/5]">
                  <FighterCardPreview charId={c.id} active={active} />
                  {active ? (
                    <span
                      className="absolute inset-x-0 top-0 h-1"
                      style={{ background: c.aura }}
                    />
                  ) : null}
                </div>
                <span className="mt-3 block font-black tracking-wider">{c.name}</span>
                <span className="mt-0.5 block text-[11px] leading-tight text-white/45">
                  {c.tagline}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* mode switch */}
        <div className="mt-8 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
          <button
            onClick={() => setTab("cpu")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === "cpu" ? "bg-[#4be3ff] text-[#070a18]" : "text-white/60 hover:text-white"
            }`}
          >
            <Gamepad2 className="size-4" /> VS CPU
          </button>
          <button
            onClick={() => setTab("online")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === "online" ? "bg-[#ff4f6b] text-white" : "text-white/60 hover:text-white"
            }`}
          >
            <Globe2 className="size-4" /> ONLINE
          </button>
        </div>

        {tab === "cpu" ? (
          <motion.section
            key="cpu"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
          >
            <h2 className="text-lg font-black tracking-wide">TRAINING BOUT</h2>
            <p className="mt-1 text-sm text-white/50">
              Warm up against the AI — three difficulties, same rules as online.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {(["easy", "normal", "hard"] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDiff(d)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition ${
                    diff === d ? "border-[#4be3ff] bg-[#4be3ff]/15 text-[#070a18]" : "border-white/15 text-white/50 hover:border-white/40"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                <span
                  className="size-8 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${getCharacter(foeId).accent}, ${getCharacter(foeId).aura})`,
                  }}
                />
                <div>
                  <div className="text-xs text-white/40">OPPONENT</div>
                  <div className="font-black tracking-wide">{getCharacter(foeId).name}</div>
                </div>
                <button
                  onClick={randomFoe}
                  className="ml-2 rounded-lg border border-white/15 p-2 text-white/60 transition hover:border-[#4be3ff] hover:text-[#4be3ff]"
                  aria-label="Random opponent"
                >
                  <Dices className="size-4" />
                </button>
              </div>

              <Button
                onClick={launchCpu}
                className="h-12 bg-[#ff4f6b] px-8 text-base font-black tracking-widest text-white hover:bg-[#ff4f6b]/85"
              >
                <Swords className="mr-2 size-5" /> ENTER THE ROOFTOP
              </Button>
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="online"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 grid gap-4 md:grid-cols-2"
          >
            <div className="rounded-2xl border border-[#ff4f6b]/40 bg-[#ff4f6b]/5 p-5">
              <div className="flex items-center gap-2 font-black tracking-wide text-[#ff4f6b]">
                <Users className="size-5" /> CREATE A ROOM
              </div>
              <p className="mt-2 text-sm text-white/55">
                Get a 5-character code. Send it to a friend — America to India, same
                rooftop. They join, you start the fight.
              </p>
              <Button
                onClick={onCreate}
                disabled={busy}
                className="mt-4 h-12 w-full bg-[#ff4f6b] font-black tracking-widest text-white hover:bg-[#ff4f6b]/85"
              >
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                CREATE ROOM
              </Button>
            </div>

            <div className="rounded-2xl border border-white/12 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 font-black tracking-wide text-[#4be3ff]">
                <Globe2 className="size-5" /> JOIN WITH CODE
              </div>
              <p className="mt-2 text-sm text-white/55">
                A friend already created a room? Punch in their code and drop straight
                into the lobby.
              </p>
              <div className="mt-4 flex gap-2">
                <Input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                  placeholder="CODE"
                  className="h-12 flex-1 border-white/15 bg-black/40 text-center font-mono text-xl tracking-[0.4em] uppercase text-white placeholder:text-white/25"
                />
                <Button
                  onClick={onJoin}
                  disabled={busy || joinCode.trim().length < 4}
                  className="h-12 bg-[#4be3ff] px-6 font-black tracking-widest text-[#070a18] hover:bg-[#4be3ff]/85"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "JOIN"}
                </Button>
              </div>
            </div>

            {error ? (
              <p className="md:col-span-2 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            <div className="md:col-span-2 rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-white/50">
              <span className="font-bold text-white/70">CONTROLS · MOBILE:</span> left
              stick to move/crouch/jump &amp; do motions (down → forward = quarter
              circle), buttons L / H / S to attack.{" "}
              <span className="font-bold text-white/70">KEYBOARD:</span> WASD/arrows +
              J (light) K (heavy) L (special).
            </div>
          </motion.section>
        )}
      </main>

      <p className="mt-2 text-xs text-center text-white/20">
        Pick your fighter, then step onto the rooftop.
      </p>
    </div>
  );
}

/** Small 3D fight read-in for the character selection card.
 *  One WebGLContext per preview is required, so previews mount lazily and are
 *  capped to keep the total draw budget predictable on mobile. */
function FighterCardPreview({ charId, active }: { charId: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = ref as React.MutableRefObject<HTMLDivElement>;

  useEffect(() => {
    const hostEl = ref.current;
    if (!hostEl) return;
    setMounted(true);
    let disposed = false;
    (async () => {
      try {
        const { renderer, scene, camera, fighter } = await buildPreview(hostEl, charId);
        if (disposed) {
          disposePreview(renderer, scene, camera, fighter);
          return;
        }
        setReady(true);
      } catch {
        setReady(true);
      }
    })();
    return () => {
      disposed = true;
      setReady(false);
      setMounted(false);
    };
  }, [charId]);

  return (
    <div ref={ref} className="absolute inset-0 z-0">
      {!mounted ? (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tracking-widest text-[#4be3ff]">
          {charId.toUpperCase()}
        </span>
      ) : ready ? null : (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tracking-widest text-white/40">
          LOADING
        </span>
      )}
    </div>
  );
}

/** Build a tiny 3D read-in of `charId` into `hostEl`.
 *  Reuses the same arena lighting language and the same rig builder as the fight,
 *  so the selection card and the fight screen read as siblings. */
function freshMock(charId: string): Fighter {
  return {
    charId,
    state: "idle",
    stateT: 0,
    move: null,
    moveFrame: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    side: 0,
    blocking: false,
    airborne: false,
    jumpLatch: false,
    comboHits: 0,
    comboT: 0,
    pending: null,
    rehitT: 0,
    hitsLanded: 0,
    buf: [],
    hitstun: 0,
    blockstun: 0,
    downT: 0,
    invuln: 0,
    projCd: 0,
    spawned: false,
    hp: 100,
    meter: 0,
    walkPhase: 0,
    acked: 0,
    predT: 0,
  };
}

async function buildPreview(
  hostEl: HTMLDivElement,
  charId: string,
): Promise<{
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  fighter: THREE.Group;
}> {
  const hostW = hostEl.clientWidth || 60;
  const hostH = hostEl.clientHeight || 75;
  const renderer = new THREE.WebGLRenderer({
    canvas: document.createElement("canvas"),
    antialias: false,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.2));
  renderer.setSize(hostW, hostH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  hostEl.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(22, hostW / hostH, 1, 1600);
  camera.position.set(0, 60, 150);
  camera.lookAt(0, 46, 0);

  // the roster preview has to match the fighter the match will hand the player:
  // same height as the model it will be swapped for, same lighting family
  const props = rigProportionsFor(getCharacter(charId));
  const disposables: Disposable[] = [];
  const rig = buildFighterRig(props, disposables);
  rig.root.position.set(-160, 0, 0);
  rig.root.rotation.y = 0;
  scene.add(rig.root);

  // warm key / cool fill / warm rim, the same family the arena uses
  const key = new THREE.DirectionalLight(0xffdcae, 1.25);
  key.position.set(-220, 180, 220);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8098cc, 0.5);
  fill.position.set(220, 120, -200);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xd08f45, 0.6);
  rim.position.set(120, 60, -260);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0x232a33, 0.6));

  // drop the procedural rig so the thumbnail leans on the pose, not the load
  applyRigPose(rig, baseStanceA());
  rigPoseForA(freshMock(charId), 0, (rig.pose as unknown as Pose3) as Pose3);
  applyRigPose(rig, (rig.pose as unknown as Pose3) as Pose3);

  renderer.render(scene, camera);

  return {
    renderer,
    scene,
    camera,
    fighter: rig.root,
  };
}

/** Teardown a preview during hot reload or card unmount. */
function disposePreview(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  fighter: THREE.Group,
) {
  renderer.render(scene, camera);
  renderer.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (o as unknown as { material?: THREE.Material }).material;
    if (mat) mat.dispose();
  });
  camera.dispose();
  if (fighter.parent) fighter.parent.remove(fighter);
  fighter.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (o as unknown as { material?: THREE.Material }).material;
    if (mat) mat.dispose();
  });
  if (fighter.parent) fighter.parent.remove(fighter);
}
