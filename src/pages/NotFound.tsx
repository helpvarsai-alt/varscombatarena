import { motion } from "framer-motion";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="min-h-dvh flex flex-col items-center justify-center gap-5 bg-[#070a18] px-4 text-center text-white"
    >
      <p
        className="text-7xl font-black tracking-tight"
        style={{ textShadow: "0 0 40px rgba(75,227,255,0.55)" }}
      >
        404
      </p>
      <p className="text-sm uppercase tracking-[0.3em] text-white/45">
        This arena doesn't exist
      </p>
      <Link
        to="/play"
        className="rounded-lg bg-[#4be3ff] px-5 py-2.5 font-bold text-[#070a18] transition hover:bg-[#4be3ff]/85"
      >
        BACK TO THE FIGHT
      </Link>
    </motion.div>
  );
}
