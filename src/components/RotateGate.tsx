import { motion } from "framer-motion";
import { Smartphone } from "lucide-react";
import { useEffect } from "react";
import { useNeedsLandscape } from "@/hooks/use-landscape";

/**
 * The whole site plays horizontally. On phones and tablets held upright this
 * gate covers every route with a "rotate your device" prompt (the same
 * contract every landscape mobile game uses); once the player turns the
 * device it disappears and nothing else changes. Desktop is never gated.
 */
export default function RotateGate() {
  const needsLandscape = useNeedsLandscape();

  // the page behind is inert while gated — no rubber-band scrolling the
  // player can't see past
  useEffect(() => {
    if (!needsLandscape) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [needsLandscape]);

  if (!needsLandscape) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[100] grid place-items-center bg-[#070a18]/96 p-8 text-center text-white backdrop-blur-md [-webkit-tap-highlight-color:transparent]"
    >
      <div>
        {/* phone that turns itself sideways on a loop */}
        <motion.div
          animate={{ rotate: [0, 0, 90, 90, 0] }}
          transition={{
            duration: 3,
            repeat: Infinity,
            times: [0, 0.16, 0.5, 0.74, 1],
            ease: "easeInOut",
          }}
          className="mx-auto w-fit rounded-[28px] border-2 border-[#4be3ff]/70 bg-gradient-to-b from-[#0d1428] to-[#0a0f1f] p-2 shadow-[0_0_50px_rgba(75,227,255,0.35)]"
        >
          <div className="relative h-24 w-40 overflow-hidden rounded-xl bg-gradient-to-br from-[#ff4fa3]/35 via-[#4be3ff]/25 to-[#ffd166]/25">
            <span className="absolute bottom-2 left-2 size-6 rounded-full border border-white/40 bg-white/10" />
            <span className="absolute right-2 bottom-2 size-6 rounded-full border border-[#ff4fa3]/70 bg-[#ff4fa3]/30" />
          </div>
        </motion.div>

        <p className="mt-9 text-[11px] font-black tracking-[0.35em] text-[#4be3ff]">
          COMBAT VERSE
        </p>
        <h2 className="mt-3 text-2xl font-black tracking-[0.18em] sm:text-3xl">
          ROTATE YOUR DEVICE
        </h2>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-white/55">
          The arena fights in landscape — turn your phone sideways and it goes
          full screen.
        </p>
        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#4be3ff]/30 bg-[#4be3ff]/10 px-4 py-1.5 text-[11px] font-bold tracking-[0.25em] text-[#4be3ff]">
          <Smartphone className="size-3.5" /> LANDSCAPE ONLY
        </span>
      </div>
    </motion.div>
  );
}
