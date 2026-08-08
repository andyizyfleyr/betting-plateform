"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Zap } from "lucide-react";

/** Splash screen plein écran affiché au lancement de l'application. */
export function SplashScreen({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="fixed inset-0 z-[120] grid place-items-center bg-surface"
        >
          <div className="flex flex-col items-center">
            <motion.div
              initial={{ scale: 0.7, opacity: 0, rotate: -12 }}
              animate={{ scale: 1, opacity: 1, rotate: 45 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="grid h-16 w-16 place-items-center rounded-[18px] bg-betclic-red shadow-[0_20px_50px_-12px_rgba(225,0,20,0.6)]"
            >
              <Zap className="h-8 w-8 -rotate-45 fill-white text-white" strokeWidth={2.2} />
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 font-display text-2xl font-bold tracking-tight text-ink"
            >
              PULSE
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mt-1 text-[10px] font-semibold tracking-[0.34em] text-mist"
            >
              PARIS SPORTIFS
            </motion.p>
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              className="mt-8 flex items-center gap-2 text-betclic-red"
            >
              <span className="h-2 w-2 rounded-full bg-betclic-red" />
              <span className="h-2 w-2 rounded-full bg-betclic-red/70" />
              <span className="h-2 w-2 rounded-full bg-betclic-red/40" />
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}