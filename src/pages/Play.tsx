import { motion } from "framer-motion";
import { useMutation } from "convex/react";
import { Dices, Gamepad2, Globe2, Loader2, Swords, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CHARACTERS, getCharacter } from "@/game/characters";
import { getPlayerId, getPlayerName, setPlayerName } from "@/game/player";
import type { Difficulty } from "@/game/types";

/**
 * Pre-fight lobby: pick a fighter, then go 1v1 vs the CPU or open a room code
 * a friend can join from anywhere on Earth. No sign-in — identity is the
 * device id + the 5-character room code.
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
      {/* top bar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-left"
          aria-label="Back to home"
        >
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-[#4be3ff] to-[#ff4fa3] font-black text-[#070a18]">
            CV
          </span>
          <span className="font-black tracking-widest text-[#4be3ff]">COMBAT VERSE</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-white/40 sm:block">YOUR NAME</span>
          <Input
            value={name}
            onChange={(e) => saveName(e.target.value)}
            maxLength={20}
            className="w-32 border-white/15 bg-white/5 text-white placeholder:text-white/30 sm:w-40"
            placeholder="Fighter"
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">
        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-black tracking-tight sm:text-5xl"
        >
          CHOOSE YOUR <span className="text-[#ff4fa3]">FIGHTER</span>
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
                className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? "border-transparent shadow-lg"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25"
                }`}
                style={
                  active
                    ? {
                        boxShadow: `0 0 0 2px ${c.aura}, 0 12px 40px -12px ${c.aura}`,
                        background: `linear-gradient(160deg, ${c.aura}22, rgba(255,255,255,0.03))`,
                      }
                    : undefined
                }
              >
                <span
                  className="mb-3 block h-14 w-full rounded-lg"
                  style={{
                    background: `radial-gradient(circle at 30% 30%, ${c.accent}, ${c.aura} 55%, #0b1020)`,
                    boxShadow: active ? `0 0 24px ${c.aura}` : "none",
                  }}
                />
                <span className="block font-black tracking-wider">{c.name}</span>
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
              tab === "online" ? "bg-[#ff4fa3] text-white" : "text-white/60 hover:text-white"
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
                    diff === d
                      ? "border-[#4be3ff] bg-[#4be3ff]/15 text-[#4be3ff]"
                      : "border-white/15 text-white/50 hover:border-white/40"
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
                className="h-12 bg-gradient-to-r from-[#4be3ff] to-[#3ef0c5] px-8 text-base font-black tracking-widest text-[#070a18] hover:opacity-90"
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
            <div className="rounded-2xl border border-[#ff4fa3]/40 bg-[#ff4fa3]/5 p-5">
              <div className="flex items-center gap-2 font-black tracking-wide text-[#ff4fa3]">
                <Users className="size-5" /> CREATE A ROOM
              </div>
              <p className="mt-2 text-sm text-white/55">
                Get a 5-character code. Send it to a friend — America to India, same
                rooftop. They join, you start the fight.
              </p>
              <Button
                onClick={onCreate}
                disabled={busy}
                className="mt-4 h-12 w-full bg-[#ff4fa3] font-black tracking-widest text-white hover:bg-[#ff4fa3]/85"
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
    </div>
  );
}
