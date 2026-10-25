"use client";

/**
 * Retours sensoriels légers sur mobile (vibration haptique + signal audio WebAudio sans fichier externe),
 * activés uniquement lorsque les préférences `haptics` / `sound` de l'utilisateur sont cochées.
 */

export function triggerHaptic(
  enabled: boolean | undefined,
  pattern: number | number[] = 14
): void {
  if (!enabled) return;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* silencieux sur navigateurs sans support */
  }
}

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

export function playUiSound(
  enabled: boolean | undefined,
  kind: "tap" | "bet" | "win"
): void {
  if (!enabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    const now = ctx.currentTime;
    const notes =
      kind === "win"
        ? [523.25, 659.25, 783.99]
        : kind === "bet"
          ? [440, 587.33]
          : [520];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.065);
      gain.gain.setValueAtTime(0.0001, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.045, now + i * 0.065 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.065 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.15);
    });
  } catch {
    /* silencieux */
  }
}
