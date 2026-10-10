import { Link, useNavigate } from "react-router";
import { ArrowLeft, Gamepad2, LogOut } from "lucide-react";

/**
 * The app shell is a game.
 *
 * CombatVerse plays on phones, in landscape, so the "browser chrome" is reduced
 * to one compact bar: the brand on the left, the player's active game in the
 * middle, and a single escaped escape hatch on the right. Everything behind it
 * is the fight, the lobby, and the fighters.
 */
export function GameBar() {
  const navigate = useNavigate();

  return (
    <header className="pointer-events-none fixed left-0 top-0 z-50 h-14 w-full border-b border-white/8 bg-black/50 px-4 backdrop-blur-md sm:px-6">
      <div className="pointer-events-auto flex h-full items-center justify-between gap-3">
        {/* brand — always returns home */}
        <Link
          to="/"
          className="flex items-center gap-2 text-sm font-black tracking-widest text-white/90 transition hover:text-white"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#4be3ff] to-[#ff4fa3] font-black text-[#070a18] shadow-lg shadow-[#4be3ff]/30">
            CV
          </span>
          <span className="hidden sm:inline">COMBAT VERSE</span>
        </Link>

        {/* active game indicator */}
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur">
          <Gamepad2 className="size-4 text-[#ff4fa3]" />
          <span className="truncate text-xs font-black tracking-wider text-white/60 sm:text-sm">
            FIGHT
          </span>
          <ArrowLeft className="size-3.5 shrink-0 text-white/30" />
        </div>

        {/* escape hatch — returns to the cockpit, never dead-ends */}
        <button
          onClick={() => navigate("/play")}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/60 transition hover:border-[#ff4fa3]/40 hover:text-[#ff4fa3] active:scale-95"
          aria-label="Back to the lobby"
        >
          <LogOut className="size-3.5" />
          <span className="hidden sm:inline">LOBBY</span>
        </button>
      </div>
    </header>
  );
}
