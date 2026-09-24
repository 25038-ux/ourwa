import type { Transition, Variants } from "motion/react";

/** Motion language: physical springs for things you touch, quick eases for things that appear. */
export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const softSpring: Transition = { type: "spring", stiffness: 220, damping: 26 };
export const snappy: Transition = { type: "spring", stiffness: 600, damping: 38 };
export const ease: Transition = { duration: 0.32, ease: [0.22, 1, 0.36, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: ease },
};

export const stagger = (step = 0.045, delay = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

export const page: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16 } },
};

type NativeShell = {
  webkit?: { messageHandlers?: { forsa?: { postMessage(m: unknown): void } } };
  ForsaAndroid?: { haptic(ms: number): void };
};

/** Short tap for a number, "success" pattern for an array. Uses the native iOS/Android shell when present. */
export function haptic(pattern: number | number[] = 8): void {
  try {
    if (typeof window === "undefined") return;
    const shell = window as unknown as NativeShell;
    const ios = shell.webkit?.messageHandlers?.forsa;
    if (ios) {
      const style = Array.isArray(pattern) ? "success" : pattern >= 12 ? "medium" : "light";
      ios.postMessage({ type: "haptic", style });
      return;
    }
    if (shell.ForsaAndroid) {
      shell.ForsaAndroid.haptic(Array.isArray(pattern) ? pattern[0] : pattern);
      return;
    }
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}
