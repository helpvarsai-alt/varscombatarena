import { motion } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import {
  Copy,
  Gamepad2,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { sfx } from "@/game/audio";
import { getCharacter, type CharacterTheme } from "@/game/characters";
import { MOVES } from "@/game/combos";
import { GameEngine } from "@/game/engine";
import type { InputManager } from "@/game/input";
import { getPlayerId, getPlayerName } from "@/game/player";
import { World, type Snap } from "@/game/sim";
import type { Difficulty, GameMode, Renderer2D3D } from "@/game/types";

/* ========================================================================== */
/*  Match page: lobby (online) + the fight screen                             */
/* ========================================================================== */

interface RoomInfo {
  code: string;
  hostId: string;
  hostName: string;
  hostChar: string;
  hostSnap?: string | null;
  guestId?: string;
  guestName?: string;
  guestChar?: string;
  guestSnap?: string | null;
  status: "waiting" | "playing" | "finished";
  startedAt?: number;
  winner?: string;
  endReason?: string;
}

export default function Match() {
  const { code = "ai" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isOnline = code !== "ai";
  const uid = getPlayerId();

  const myChar = params.get("char") || "blaze";
  const foeChar = params.get("foe") || "frost";
  const diff = (params.get("diff") as Difficulty) || "normal";

  const room = useQuery(api.rooms.getRoom, isOnline ? { code } : "skip");
  const joinRoom = useMutation(api.rooms.joinRoom);
  const startMatch = useMutation(api.rooms.startMatch);
  const setCharacter = useMutation(api.rooms.setCharacter);
  const leaveRoom = useMutation(api.rooms.leaveRoom);

  const [copied, setCopied] = useState(false);

  // Leaving the page frees the seat / forfeits the match.
  useEffect(() => {
    if (!isOnline) return;
    return () => {
      void leaveRoom({ code, playerId: getPlayerId() }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, code]);

  // Deep-link join: a shared /match/CODE URL seats you directly.
  const autoJoinTried = useRef(false);
  useEffect(() => {
    if (!isOnline || !room || autoJoinTried.current) return;
    if (room.hostId === uid) return;
    if (room.guestId && room.guestId !== uid) return;
    if (room.guestId === uid) return;
    autoJoinTried.current = true;
    void joinRoom({
      code,
      playerId: uid,
      name: getPlayerName(),
      char: myChar,
    }).catch(() => {});
  }, [isOnline, room, uid, code, myChar, joinRoom]);

  if (!isOnline) {
    return (
      <FightScreen
        mode="ai"
        mySide={0}
        char0={myChar}
        char1={foeChar}
        name0={getPlayerName()}
        name1={`CPU (${getCharacter(foeChar).name})`}
        difficulty={diff}
        onLeave={() => navigate("/play")}
      />
    );
  }

  if (room === undefined) {
    return <CenterCard>Connecting to room…</CenterCard>;
  }
  if (room === null) {
    return (
      <CenterCard>
        <p className="text-xl font-black">ROOM NOT FOUND</p>
        <p className="mt-2 text-sm text-white/50">
          Code <span className="font-mono text-[#4be3ff]">{code}</span> doesn't exist
          anymore.
        </p>
        <Button asChild className="mt-5 bg-[#4be3ff] font-bold text-[#070a18]">
          <Link to="/play">Back to lobby</Link>
        </Button>
      </CenterCard>
    );
  }

  const mySide: 0 | 1 = room.hostId === uid ? 0 : 1;
  const iAmHost = room.hostId === uid;
  const seated = iAmHost || room.guestId === uid;

  if (!seated) {
    return (
      <CenterCard>
        <p className="text-xl font-black">ROOM FULL</p>
        <p className="mt-2 text-sm text-white/50">Two fighters are already here.</p>
        <Button asChild className="mt-5 bg-[#4be3ff] font-bold text-[#070a18]">
          <Link to="/play">Back to lobby</Link>
        </Button>
      </CenterCard>
    );
  }

  if (room.status === "waiting") {
    return (
      <WaitingLobby
        code={code}
        room={room}
        uid={uid}
        iAmHost={iAmHost}
        myChar={myChar}
        copied={copied}
        onCopy={() => {
          void navigator.clipboard?.writeText(code).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            () => {},
          );
        }}
        onShare={() => {
          const url = `${location.origin}/match/${code}`;
          if (navigator.share) {
            void navigator.share({
              title: "Rooftop Rumble",
              text: `Fight me in Rooftop Rumble — room code ${code}`,
              url,
            }).catch(() => {});
          } else {
            void navigator.clipboard?.writeText(url).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }
        }}
        onPick={(id) => {
          void setCharacter({ code, playerId: uid, char: id }).catch(() => {});
        }}
        onStart={() => {
          void startMatch({ code, playerId: uid }).catch(() => {});
        }}
        onLeave={() => navigate("/play")}
      />
    );
  }

  // status: playing | finished
  const incomingSnap = mySide === 0 ? room.guestSnap : room.hostSnap;
  return (
    <FightScreen
      mode="online"
      mySide={mySide}
      char0={room.hostChar}
      char1={room.guestChar ?? "frost"}
      name0={room.hostName}
      name1={room.guestName ?? "Fighter"}
      code={code}
      hostId={room.hostId}
      guestId={room.guestId}
      roomStatus={room.status}
      incomingSnap={incomingSnap}
      winnerId={room.winner}
      endReason={room.endReason}
      onLeave={() => navigate("/play")}
    />
  );
}

/* ------------------------------------------------------------------ lobby */

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#070a18] p-6 text-center text-white">
      <div>{children}</div>
    </div>
  );
}

function WaitingLobby({
  code,
  room,
  uid,
  iAmHost,
  myChar,
  copied,
  onCopy,
  onShare,
  onPick,
  onStart,
  onLeave,
}: {
  code: string;
  room: RoomInfo;
  uid: string;
  iAmHost: boolean;
  myChar: string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  onPick: (id: string) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const opponentIn = Boolean(room.guestId);
  const myTheme = getCharacter(iAmHost ? room.hostChar : (room.guestChar ?? myChar));
  const oppTheme = getCharacter(
    iAmHost ? (room.guestChar ?? "frost") : room.hostChar,
  );

  return (
    <div className="min-h-screen bg-[#070a18] text-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between">
          <span className="font-black tracking-widest text-[#4be3ff]">
            ROOM LOBBY
          </span>
          <button
            onClick={onLeave}
            className="flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:border-red-400/60 hover:text-red-300"
          >
            <LogOut className="size-3.5" /> LEAVE
          </button>
        </div>

        {/* code block */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 rounded-3xl border border-[#ff4fa3]/40 bg-gradient-to-b from-[#ff4fa3]/10 to-transparent p-6 text-center"
        >
          <p className="text-xs uppercase tracking-[0.3em] text-white/45">
            Room code — share with your friend anywhere
          </p>
          <div className="mt-3 font-mono text-5xl font-black tracking-[0.35em] text-white sm:text-6xl">
            {code}
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              onClick={onCopy}
              variant="outline"
              className="border-white/20 bg-white/5 text-white hover:bg-white/10"
            >
              <Copy className="mr-2 size-4" /> {copied ? "COPIED!" : "COPY CODE"}
            </Button>
            <Button
              onClick={onShare}
              className="bg-[#ff4fa3] font-bold text-white hover:bg-[#ff4fa3]/85"
            >
              SHARE LINK
            </Button>
          </div>
        </motion.div>

        {/* fighters */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Slot theme={myTheme} label={`${room.hostId === uid ? room.hostName : (room.guestName ?? "You")} (YOU)`} active />
          <Slot
            theme={opponentIn ? oppTheme : null}
            label={opponentIn ? (iAmHost ? room.guestName ?? "Friend" : room.hostName) : "WAITING FOR OPPONENT…"}
          />
        </div>

        {/* my pick */}
        <p className="mt-6 text-xs uppercase tracking-[0.25em] text-white/40">
          Tap to switch fighter
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(["blaze", "frost", "volt", "terra", "nyx", "tide"] as const).map((id) => {
            const t = getCharacter(id);
            const active = t.id === myTheme.id;
            return (
              <button
                key={id}
                onClick={() => onPick(id)}
                className={`rounded-xl border p-2 text-center transition ${
                  active ? "border-transparent" : "border-white/10 hover:border-white/30"
                }`}
                style={
                  active
                    ? { boxShadow: `0 0 0 2px ${t.aura}`, background: `${t.aura}18` }
                    : { background: "rgba(255,255,255,0.03)" }
                }
              >
                <span
                  className="mx-auto mb-1 block h-8 w-full rounded"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${t.accent}, ${t.aura})`,
                  }}
                />
                <span className="text-[11px] font-black tracking-wider">{t.name}</span>
              </button>
            );
          })}
        </div>

        {/* start */}
        <div className="mt-7 text-center">
          {iAmHost ? (
            <Button
              onClick={onStart}
              disabled={!opponentIn}
              className="h-14 bg-gradient-to-r from-[#4be3ff] to-[#3ef0c5] px-10 text-base font-black tracking-widest text-[#070a18] hover:opacity-90"
            >
              {opponentIn ? "START FIGHT" : "WAITING FOR FRIEND…"}
            </Button>
          ) : (
            <p className="animate-pulse text-sm text-white/55">
              The host starts the match — get ready.
            </p>
          )}
          <p className="mt-4 text-xs text-white/35">
            Works across countries — the room syncs over the cloud, not your WiFi.
          </p>
        </div>
      </div>
    </div>
  );
}

function Slot({ theme, label, active }: { theme: CharacterTheme | null; label: string; active?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
      <span
        className="mx-auto mb-2 block size-12 rounded-full"
        style={{
          background: theme
            ? `radial-gradient(circle at 35% 30%, ${theme.accent}, ${theme.aura})`
            : "rgba(255,255,255,0.08)",
          boxShadow: theme && active ? `0 0 18px ${theme.aura}` : "none",
        }}
      />
      <div className="truncate text-sm font-black tracking-wide">
        {theme ? theme.name : "…"}
      </div>
      <div className="truncate text-[11px] text-white/45">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------- fight screen */

interface FightProps {
  mode: GameMode;
  mySide: 0 | 1;
  char0: string;
  char1: string;
  name0: string;
  name1: string;
  difficulty?: Difficulty;
  code?: string;
  hostId?: string;
  guestId?: string;
  roomStatus?: "playing" | "finished";
  incomingSnap?: string | null;
  winnerId?: string;
  endReason?: string;
  onLeave: () => void;
}

function FightScreen(props: FightProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [phase, setPhase] = useState<"countdown" | "fight" | "over">("countdown");
  const [count, setCount] = useState(3);
  const [showFight, setShowFight] = useState(false);
  const [kind, setKind] = useState<Renderer2D3D>("2d");
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<0 | 1 | "tie" | null>(null);
  const [lostLink, setLostLink] = useState(false);
  const [tipIdx] = useState(() => Math.floor(Math.random() * MOVES.length));
  const isTouch =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  const sendSnap = useMutation(api.rooms.sendSnap);
  const finishMatch = useMutation(api.rooms.finishMatch);

  // latest props for the long-lived engine
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const onSend = useCallback((snap: Snap) => {
    const p = propsRef.current;
    if (p.mode !== "online" || !p.code) return;
    void sendSnap({
      code: p.code,
      playerId: getPlayerId(),
      snap: JSON.stringify(snap),
    }).catch(() => {});
  }, [sendSnap]);

  const onFinish = useCallback(
    (winner: 0 | 1 | "tie") => {
      const p = propsRef.current;
      setResult(winner);
      if (p.mode !== "online" || !p.code) return;
      const winnerId =
        winner === "tie"
          ? "tie"
          : winner === 0
            ? (p.hostId ?? "tie")
            : (p.guestId ?? "tie");
      void finishMatch({
        code: p.code,
        playerId: getPlayerId(),
        winner: winnerId,
        reason: "match_over",
      }).catch(() => {});
    },
    [finishMatch],
  );

  /* ---------------- HUD refs (imperative updates, zero React churn) ------- */
  const hpA = useRef<HTMLDivElement>(null);
  const hpB = useRef<HTMLDivElement>(null);
  const mtA = useRef<HTMLDivElement>(null);
  const mtB = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const comboA = useRef<HTMLDivElement>(null);
  const comboB = useRef<HTMLDivElement>(null);

  /* ------------------------------- mount engine -------------------------- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const p = props;
    const world = new World(p.char0, p.char1, p.mode === "online" ? ((1 - p.mySide) as 0 | 1) : null);

    const engine = new GameEngine({
      container,
      world,
      mode: p.mode,
      localSide: p.mySide,
      difficulty: p.difficulty,
      countdownMs: 3000,
      onPhase: (ph) => {
        setPhase(ph);
        if (ph === "fight") {
          setShowFight(true);
          setTimeout(() => setShowFight(false), 850);
        }
      },
      onEnd: (winner) => onFinish(winner),
      onSendSnap: (snap) => onSend(snap),
      onHud: (h) => {
        if (hpA.current) hpA.current.style.transform = `scaleX(${Math.max(0, h.hp1)})`;
        if (hpB.current) hpB.current.style.transform = `scaleX(${Math.max(0, h.hp2)})`;
        if (mtA.current) mtA.current.style.width = `${h.meter1}%`;
        if (mtB.current) mtB.current.style.width = `${h.meter2}%`;
        if (timerRef.current) timerRef.current.textContent = String(h.seconds).padStart(2, "0");
        if (comboA.current) {
          const n = h.combo1;
          comboA.current.textContent = n >= 2 ? `${n} HITS` : "";
          comboA.current.style.opacity = n >= 2 ? "1" : "0";
        }
        if (comboB.current) {
          const n = h.combo2;
          comboB.current.textContent = n >= 2 ? `${n} HITS` : "";
          comboB.current.style.opacity = n >= 2 ? "1" : "0";
        }
      },
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------- incoming snapshots ------------------------ */
  const lastSnapRef = useRef(0);
  useEffect(() => {
    if (!props.incomingSnap || !engineRef.current) return;
    try {
      engineRef.current.applyRemote(JSON.parse(props.incomingSnap) as Snap);
      lastSnapRef.current = Date.now();
    } catch {
      /* ignore malformed packet */
    }
  }, [props.incomingSnap]);

  // connection watchdog (online)
  useEffect(() => {
    if (props.mode !== "online" || props.roomStatus !== "playing") return;
    const id = setInterval(() => {
      setLostLink(
        lastSnapRef.current > 0 && Date.now() - lastSnapRef.current > 5000,
      );
    }, 1500);
    return () => clearInterval(id);
  }, [props.mode, props.roomStatus]);

  /* ------------------------------- countdown ----------------------------- */
  useEffect(() => {
    if (phase !== "countdown") return;
    const id = setInterval(() => {
      const left = engineRef.current?.countdownLeft() ?? 0;
      setCount(Math.max(1, Math.ceil(left / 1000)));
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  /* ------------------------------- online result ------------------------- */
  const myWinner = (() => {
    if (props.mode === "ai") return result;
    if (props.roomStatus !== "finished") return null;
    const w = props.winnerId;
    if (!w) return null;
    if (w === "tie") return "tie" as const;
    const uid = getPlayerId();
    // translate id -> side using names we know (host is side 0)
    return w === uid ? "win" : "lose";
  })();
  const aiResult =
    props.mode === "ai" && result !== null
      ? result === "tie"
        ? ("tie" as const)
        : result === props.mySide
          ? ("win" as const)
          : ("lose" as const)
      : null;
  const verdict = props.mode === "ai" ? aiResult : myWinner;
  const finished = props.mode === "ai" ? result !== null : props.roomStatus === "finished";

  const myTheme = getCharacter(props.mySide === 0 ? props.char0 : props.char1);
  const foeTheme = getCharacter(props.mySide === 0 ? props.char1 : props.char0);

  const input = (): InputManager | undefined => engineRef.current?.input;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#070a18] text-white select-none">
      {/* ============================= arena ============================= */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        {/* ---------------------------- HUD ---------------------------- */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2 pt-2 sm:px-4 sm:pt-3">
          <div className="flex items-start gap-2">
            {/* left fighter */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="size-6 shrink-0 rounded-full border border-white/30"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${sideTheme(props, 0).accent}, ${sideTheme(props, 0).aura})`,
                  }}
                />
                <span className="truncate text-xs font-black tracking-wider sm:text-sm">
                  {props.name0}
                  {props.mySide === 0 ? (
                    <span className="ml-1 rounded bg-[#4be3ff] px-1 py-0.5 text-[9px] text-[#070a18]">
                      YOU
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-4 w-full overflow-hidden rounded-md border border-white/20 bg-black/60">
                <div
                  ref={hpA}
                  className="h-full origin-left bg-gradient-to-r from-[#3ef0c5] via-[#9ff58a] to-[#ffd166]"
                  style={{ transform: "scaleX(1)" }}
                />
              </div>
              <div className="mt-1 h-1.5 w-2/3 overflow-hidden rounded bg-black/60">
                <div
                  ref={mtA}
                  className="h-full bg-gradient-to-r from-[#4be3ff] to-[#b06bff] transition-[width]"
                  style={{ width: "0%" }}
                />
              </div>
            </div>

            {/* timer */}
            <div className="shrink-0 px-1 text-center">
              <div
                ref={timerRef}
                className="font-mono text-3xl font-black leading-none text-white sm:text-4xl"
                style={{ textShadow: "0 0 14px rgba(75,227,255,0.6)" }}
              >
                99
              </div>
              <div className="mt-0.5 text-[9px] tracking-[0.25em] text-white/40">
                {props.mode === "online" ? "ONLINE" : "VS CPU"}
              </div>
            </div>

            {/* right fighter */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-end gap-2">
                <span className="truncate text-right text-xs font-black tracking-wider sm:text-sm">
                  {props.name1}
                  {props.mySide === 1 ? (
                    <span className="ml-1 rounded bg-[#4be3ff] px-1 py-0.5 text-[9px] text-[#070a18]">
                      YOU
                    </span>
                  ) : null}
                </span>
                <span
                  className="size-6 shrink-0 rounded-full border border-white/30"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${sideTheme(props, 1).accent}, ${sideTheme(props, 1).aura})`,
                  }}
                />
              </div>
              <div className="mt-1 flex justify-end">
                <div className="h-4 w-full overflow-hidden rounded-md border border-white/20 bg-black/60">
                  <div
                    ref={hpB}
                    className="h-full origin-right bg-gradient-to-r from-[#ffd166] via-[#ff9d6b] to-[#ff4f6b]"
                    style={{ transform: "scaleX(1)" }}
                  />
                </div>
              </div>
              <div className="mt-1 flex justify-end">
                <div className="h-1.5 w-2/3 overflow-hidden rounded bg-black/60">
                  <div
                    ref={mtB}
                    className="ml-auto h-full bg-gradient-to-r from-[#b06bff] to-[#ff4fa3] transition-[width]"
                    style={{ width: "0%" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* combo popups */}
          <div className="mt-1 flex justify-between px-1">
            <div
              ref={comboA}
              className="text-lg font-black tracking-widest text-[#ffd166] opacity-0 transition-opacity"
              style={{ textShadow: "0 0 12px rgba(255,209,102,0.8)" }}
            />
            <div
              ref={comboB}
              className="text-lg font-black tracking-widest text-[#ffd166] opacity-0 transition-opacity"
              style={{ textShadow: "0 0 12px rgba(255,209,102,0.8)" }}
            />
          </div>
        </div>

        {/* --------------------------- overlays ------------------------- */}
        {phase === "countdown" ? (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
            <motion.div
              key={count}
              initial={{ scale: 1.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-8xl font-black text-white"
              style={{ textShadow: "0 0 40px rgba(75,227,255,0.9)" }}
            >
              {count}
            </motion.div>
          </div>
        ) : null}
        {showFight ? (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center">
            <motion.div
              initial={{ scale: 2.4, opacity: 0, rotate: -6 }}
              animate={{ scale: 1, opacity: 1, rotate: -6 }}
              className="text-7xl font-black tracking-tighter text-[#ff4fa3] sm:text-9xl"
              style={{ textShadow: "0 0 50px rgba(255,79,163,0.8)" }}
            >
              FIGHT!
            </motion.div>
          </div>
        ) : null}

        {lostLink ? (
          <div className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full border border-yellow-400/50 bg-yellow-500/15 px-4 py-1.5 text-xs font-bold text-yellow-200">
            Reconnecting to opponent…
          </div>
        ) : null}

        {/* toolbar */}
        <div className="absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2 py-1.5 backdrop-blur">
          <button
            onClick={() => {
              const next: Renderer2D3D = kind === "2d" ? "3d" : "2d";
              setKind(next);
              engineRef.current?.setRenderer(next);
              sfx.ui();
            }}
            className="rounded-full px-3 py-1 text-[11px] font-black tracking-wider text-[#4be3ff] hover:bg-white/10"
            title="Toggle 2D / 3D"
          >
            {kind.toUpperCase()}
          </button>
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              sfx.setEnabled(!next);
            }}
            className="rounded-full p-1.5 text-white/70 hover:bg-white/10"
            title="Sound"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          {props.mode === "ai" ? (
            <button
              onClick={() => {
                if (paused) {
                  engineRef.current?.resume();
                  setPaused(false);
                } else {
                  engineRef.current?.pause();
                  setPaused(true);
                }
                sfx.ui();
              }}
              className="rounded-full p-1.5 text-white/70 hover:bg-white/10"
              title="Pause"
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
          ) : null}
          <button
            onClick={props.onLeave}
            className="rounded-full p-1.5 text-white/70 hover:bg-white/10"
            title="Leave match"
          >
            <LogOut className="size-4" />
          </button>
        </div>

        {/* ------------------------- pause overlay ---------------------- */}
        {paused ? (
          <div className="absolute inset-0 z-40 grid place-items-center bg-black/70 backdrop-blur-sm">
            <div className="text-center">
              <p className="text-4xl font-black tracking-widest">PAUSED</p>
              <Button
                onClick={() => {
                  engineRef.current?.resume();
                  setPaused(false);
                }}
                className="mt-5 bg-[#4be3ff] font-bold text-[#070a18]"
              >
                RESUME
              </Button>
              <div>
                <Button
                  variant="ghost"
                  className="mt-2 text-white/60"
                  onClick={props.onLeave}
                >
                  QUIT MATCH
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* -------------------------- result overlay --------------------- */}
        {finished ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-40 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0d1428] p-7 text-center"
            >
              <p
                className="text-5xl font-black tracking-tight"
                style={{
                  color:
                    verdict === "win"
                      ? "#3ef0c5"
                      : verdict === "lose"
                        ? "#ff4f6b"
                        : "#ffd166",
                  textShadow:
                    verdict === "win"
                      ? "0 0 30px rgba(62,240,197,0.5)"
                      : verdict === "lose"
                        ? "0 0 30px rgba(255,79,107,0.5)"
                        : "0 0 30px rgba(255,209,102,0.5)",
                }}
              >
                {verdict === "win"
                  ? "VICTORY"
                  : verdict === "lose"
                    ? "DEFEAT"
                    : "DRAW"}
              </p>
              <div className="mt-4 flex items-center justify-center gap-4">
                <FighterChip theme={myTheme} label="YOU" />
                <span className="text-2xl font-black text-white/40">VS</span>
                <FighterChip theme={foeTheme} label={props.name1} />
              </div>
              {props.endReason === "opponent_left" ? (
                <p className="mt-4 text-xs uppercase tracking-widest text-white/45">
                  Opponent left the match
                </p>
              ) : null}
              <div className="mt-6 flex flex-col gap-2">
                {props.mode === "ai" ? (
                  <Button
                    onClick={() => {
                      // fresh page load = fresh engine, world and countdown
                      location.reload();
                    }}
                    className="h-12 bg-gradient-to-r from-[#4be3ff] to-[#3ef0c5] font-black tracking-widest text-[#070a18]"
                  >
                    <RotateCcw className="mr-2 size-4" /> REMATCH
                  </Button>
                ) : (
                  <Button
                    asChild
                    className="h-12 bg-[#ff4fa3] font-black tracking-widest text-white"
                  >
                    <Link to="/play">
                      <Gamepad2 className="mr-2 size-4" /> NEW MATCH
                    </Link>
                  </Button>
                )}
                <Button
                  asChild
                  variant="ghost"
                  className="text-white/60"
                >
                  <Link to="/play">BACK TO LOBBY</Link>
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </div>

      {/* ============================ controls ============================ */}
      {isTouch ? (
        <div className="relative z-30 h-[36vh] max-h-64 min-h-44 touch-none">
          <Joystick onStick={(x, y) => input()?.setStick(x, y)} />
          <div className="absolute bottom-4 right-4 flex items-end gap-3">
            <ActionBtn
              label="L"
              hint="light"
              color="#4be3ff"
              onPress={() => input()?.press("L")}
            />
            <ActionBtn
              label="H"
              hint="heavy"
              color="#ff4fa3"
              onPress={() => input()?.press("H")}
            />
            <ActionBtn
              label="S"
              hint="special"
              color="#ffd166"
              onPress={() => input()?.press("S")}
              big
            />
          </div>
          <div className="pointer-events-none absolute bottom-1 left-1/2 hidden -translate-x-1/2 text-[10px] text-white/30 sm:block">
            {MOVES[tipIdx].name}: {MOVES[tipIdx].hint}
          </div>
        </div>
      ) : (
        <div className="relative z-30 flex h-14 items-center justify-center gap-3 text-[11px] text-white/45">
          <Key k="W A S D" /> move / jump / crouch
          <span className="text-white/20">·</span>
          <Key k="J" /> light <Key k="K" /> heavy <Key k="L" /> special
          <span className="text-white/20">·</span>
          <span className="text-white/30">{MOVES[tipIdx].hint}</span>
        </div>
      )}
    </div>
  );
}

function sideTheme(props: FightProps, side: 0 | 1): CharacterTheme {
  return getCharacter(side === 0 ? props.char0 : props.char1);
}

function FighterChip({ theme, label }: { theme: CharacterTheme; label: string }) {
  return (
    <div className="text-center">
      <span
        className="mx-auto mb-1 block size-10 rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 30%, ${theme.accent}, ${theme.aura})`,
          boxShadow: `0 0 16px ${theme.aura}`,
        }}
      />
      <div className="text-[11px] font-black tracking-wider">{theme.name}</div>
      <div className="text-[10px] text-white/40">{label}</div>
    </div>
  );
}

function Key({ k }: { k: string }) {
  return (
    <kbd className="rounded border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
      {k}
    </kbd>
  );
}

/* --------------------------------------------------------------- controls */

function Joystick({ onStick }: { onStick: (x: number, y: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const R = 46;

  const update = (e: React.PointerEvent) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    onStick(dx / R, dy / R);
  };

  const end = (e: React.PointerEvent) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    onStick(0, 0);
  };

  return (
    <div
      ref={baseRef}
      onPointerDown={(e) => {
        if (pid.current !== null) return;
        pid.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (pid.current === e.pointerId) update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      className="absolute bottom-4 left-4 grid size-36 touch-none place-items-center rounded-full border border-white/20 bg-white/5 backdrop-blur-sm"
      style={{ touchAction: "none" }}
      aria-label="Movement stick"
    >
      {/* direction ticks */}
      <span className="absolute top-2 text-[10px] text-white/40">▲</span>
      <span className="absolute bottom-2 text-[10px] text-white/40">▼</span>
      <span className="absolute left-2 text-[10px] text-white/40">◀</span>
      <span className="absolute right-2 text-[10px] text-white/40">▶</span>
      <div
        ref={knobRef}
        className="size-14 rounded-full border border-white/40 bg-gradient-to-b from-white/25 to-white/5 shadow-lg"
      />
    </div>
  );
}

function ActionBtn({
  label,
  hint,
  color,
  onPress,
  big,
}: {
  label: string;
  hint: string;
  color: string;
  onPress: () => void;
  big?: boolean;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className={`grid touch-none place-items-center rounded-full border-2 font-black text-[#070a18] transition active:scale-90 ${
        big ? "size-[4.5rem]" : "size-16"
      }`}
      style={{
        touchAction: "none",
        borderColor: color,
        background: `radial-gradient(circle at 35% 28%, #ffffffcc, ${color})`,
        boxShadow: `0 0 18px ${color}66`,
      }}
      aria-label={`${label} button (${hint})`}
    >
      <span className="text-xl leading-none">{label}</span>
      <span className="text-[8px] font-bold uppercase tracking-wider opacity-60">
        {hint}
      </span>
    </button>
  );
}
