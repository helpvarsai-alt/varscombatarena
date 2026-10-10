import { motion } from "framer-motion";
import { ArrowRight, Cpu, Globe2, Smartphone, Zap } from "lucide-react";
import { Link } from "react-router";
import { CHARACTERS } from "@/game/characters";
import { MOVES } from "@/game/combos";

/**
 * VARS Combat Arena — landing. A neon rooftop fighting game you can play with a
 * friend anywhere via a room code, or warm up against the AI. 2D & 3D.
 */
export default function Landing() {
  return (
    <div className="min-h-dvh bg-[#070a18] text-white">
      {/* ================================ NAV ================================ */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-[#4be3ff] to-[#ff4fa3] font-black text-[#070a18]">
            V
          </span>
          <span className="font-black tracking-widest text-[#4be3ff]">
            VARS COMBAT ARENA
          </span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <a href="#roster" className="hidden text-white/60 hover:text-white sm:block">
            Roster
          </a>
          <a href="#combos" className="hidden text-white/60 hover:text-white sm:block">
            Combos
          </a>
          <Link
            to="/play"
            className="rounded-lg bg-[#4be3ff] px-4 py-2 font-bold text-[#070a18] transition hover:bg-[#4be3ff]/85"
          >
            PLAY NOW
          </Link>
        </nav>
      </header>

      {/* ================================ HERO =============================== */}
      <section className="relative overflow-hidden">
        {/* glow field */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[#ff4fa3]/20 blur-[120px]" />
        <div className="pointer-events-none absolute top-32 -left-20 h-72 w-72 rounded-full bg-[#4be3ff]/15 blur-[90px]" />
        <div className="pointer-events-none absolute top-48 -right-16 h-72 w-72 rounded-full bg-[#3c1f45]/10 blur-[90px]" /><div className="relative mx-auto max-w-5xl px-4 pb-16 pt-14 text-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-[#4be3ff]/40 bg-[#4be3ff]/10 px-4 py-1.5 text-xs font-bold tracking-[0.2em] text-[#4be3ff]">
              <Zap className="size-3.5" /> VARS ARENA · MOBILE-FIRST · CROSS-PLATFORM
            </span>
            <h1 className="mt-6 text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl md:text-8xl">
              VARS
              <span
                className="block text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(100deg, #4be3ff, #3ef0c5 35%, #ffd166 65%, #ff4fa3)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                }}
              >
                ARENA
              </span>
            </h1 >
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/60 sm:text-lg">
              Six fighters. Twenty combos. One room code — challenge a friend in
              America, India, or anywhere else on the planet, or square up against
              the AI. Same moves for everyone: only your hands decide.
            </p >
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.55 }}
            className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              to="/play"
              className="group inline-flex h-14 items-center gap-2 rounded-xl bg-gradient-to-r from-[#4be3ff] to-[#3ef0c5] px-8 text-base font-black tracking-widest text-[#070a18] shadow-[0_0_40px_-8px_rgba(75,227,255,0.7)] transition hover:brightness-110"
            >
              FIGHT A FRIEND
              <ArrowRight className="size-5 transition group-hover:translate-x-1" />
            </Link>
            <Link
              to="/play"
              className="inline-flex h-14 items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-8 text-base font-black tracking-widest text-white transition hover:border-[#ff4fa3] hover:bg-[#ff4fa3]/10"
            >
              <Cpu className="size-5" /> VS CPU
            </Link>
          </motion.div>

          {/* floating vs panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="mx-auto mt-12 max-w-3xl rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 sm:p-7"
          >
            <div className="flex items-center justify-between gap-4">
              <FighterMini id="blaze" />
              <div className="text-center">
                <div className="font-mono text-4xl font-black text-[#ffd166] sm:text-5xl">
                  VS
                </div>
                <div className="mt-1 text-[10px] tracking-[0.3em] text-white/40">
                  ANYWHERE ON EARTH
                </div>
              </div>
              <FighterMini id="frost" flip />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] font-bold tracking-wider text-white/55">
              <div className="rounded-lg border border-white/10 bg-black/30 py-2">
                ROOM CODE
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 py-2">
                60 FPS SIM
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 py-2">
                2D / 3D
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ============================== FEATURES ============================= */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-4 md:grid-cols-3">
          <Feature
            icon={<Globe2 className="size-5" />}
            tone="#ff4fa3"
            title="Play from anywhere"
            body="Create a room, send the 5-character code, and your friend joins from any country. State streams through the cloud, so distance never kills the match."
          />
          <Feature
            icon={<Cpu className="size-5" />}
            tone="#4be3ff"
            title="AI that plays by the rules"
            body="Three difficulties. The CPU uses the exact same 20 combos and can be baited, spaced and punished — just like a human."
          />
          <Feature
            icon={<Smartphone className="size-5" />}
            tone="#3ef0c5"
            title="Silky on mobile"
            body="Fixed 60Hz simulation with interpolated rendering, a thumb-sized stick, three big buttons and zero account signup. Landscape or portrait."
          />
        </div>
      </section>

      {/* ================================ ROSTER ============================= */}
      <section id="roster" className="mx-auto max-w-6xl px-4 py-10">
        <SectionTitle
          kicker="THE ROSTER"
          title="SIX FIGHTERS. ONE MOVE LIST."
          sub="Every character shares all 20 combos — what changes is the animation, aura and hit effects. Pick the vibe you fight best with."
        />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CHARACTERS.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.06 }}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:-translate-y-1"
            >
              <div
                className="mb-3 h-24 w-full rounded-xl"
                style={{
                  background: `radial-gradient(circle at 32% 28%, ${c.accent}, ${c.aura} 55%, #04050c 100%)`,
                  boxShadow: `inset 0 -24px 40px -24px rgba(0,0,0,0.7)`,
                }}
              />              <div
                className="absolute -right-6 -top-6 size-20 rounded-full opacity-0 blur-2xl transition group-hover:opacity-60"
                style={{ background: c.aura, boxShadow: `0 0 40px -8px ${c.aura}` }}
              />
              <div className="font-black tracking-wider">{c.name}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-white/45">
                {c.tagline}
              </div>
              <div
                className="mt-2 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: c.aura }}
              >
                {c.auraStyle}
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ================================ COMBOS ============================= */}
      <section id="combos" className="mx-auto max-w-6xl px-4 py-10">
        <SectionTitle
          kicker="THE MOVE LIST"
          title="ALL 20 COMBOS"
          sub="Direction-qualified buttons, quarter-circle motions and double-taps — thumb-friendly on touch, exact on keyboard."
        />
        <div className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MOVES.map((m, i) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, x: -14 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: (i % 6) * 0.04 }}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <span className="w-6 shrink-0 text-center font-mono text-xs text-white/35">
                {String(m.id + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black tracking-wide">
                  {m.name}
                </div>
                <div className="truncate text-[11px] text-white/40">{m.hint}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                {m.tokens.map((t, ti) => (
                  <span
                    key={ti}
                    className="rounded border border-[#4be3ff]/40 bg-[#4be3ff]/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#4be3ff]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-white/35">
          S = special · L = light · H = heavy · d = hold down · f/b = forward/back ·
          a = airborne · qcf = down → forward · ff = double-tap forward · dd =
          double-tap down
        </p>
      </section>

      {/* ================================= CTA =============================== */}
      <section className="mx-auto max-w-4xl px-4 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="rounded-3xl border border-[#ff4fa3]/40 bg-gradient-to-b from-[#ff4fa3]/15 to-transparent p-8 sm:p-12"
        >
          <h2 className="text-3xl font-black tracking-tight sm:text-5xl">
            THINK YOU CAN <span className="text-[#ff4fa3]">TAKE THE ROOFTOP?</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/55">
            No downloads, no accounts. Pick a fighter, open a room, send the code.
          </p>
          <Link
            to="/play"
            className="mt-7 inline-flex h-14 items-center gap-2 rounded-xl bg-[#ff4fa3] px-10 text-base font-black tracking-widest text-white shadow-[0_0_44px_-8px_rgba(255,79,163,0.8)] transition hover:brightness-110"
          >
            ENTER THE ROOFTOP <ArrowRight className="size-5" />
          </Link>
        </motion.div>
      </section>

      <footer className="border-t border-white/10 py-8 text-center text-xs text-white/35">
        VARS COMBAT ARENA · 2D/3D cross-platform fighter · built for thumbs &amp;
        keyboards
      </footer>
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function SectionTitle({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub: string;
}) {
  return (
    <div>
      <div className="text-xs font-bold tracking-[0.35em] text-[#4be3ff]">{kicker}</div>
      <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-white/50">{sub}</p>
    </div>
  );
}

function Feature({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/25">
      <span
        className="mb-3 grid size-10 place-items-center rounded-xl"
        style={{ background: `${tone}22`, color: tone, boxShadow: `0 0 24px -8px ${tone}` }}
      >
        {icon}
      </span>
      <h3 className="font-black tracking-wide">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-white/50">{body}</p>
    </div>
  );
}

function FighterMini({ id, flip }: { id: string; flip?: boolean }) {
  const c = CHARACTERS.find((x) => x.id === id)!;
  return (
    <div className={`flex items-center gap-3 ${flip ? "flex-row-reverse text-right" : ""}`}>
      <motion.span
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="block size-16 rounded-2xl sm:size-20"
        style={{
          background: `radial-gradient(circle at 32% 28%, ${c.accent}, ${c.aura} 60%, #0b1020)`,
          boxShadow: `0 0 34px -6px ${c.aura}`,
        }}
      />
      <div>
        <div className="font-black tracking-widest">{c.name}</div>
        <div className="text-[11px] text-white/45">{c.tagline}</div>
      </div>
    </div>
  );
}
