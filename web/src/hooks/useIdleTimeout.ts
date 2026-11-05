import { useEffect, useRef, useState } from "react";

const EVENTS = ["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const;
const STORAGE_KEY = "ccm.lastActivity";

function readShared(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function writeShared(t: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(t));
  } catch {
    // Storage blocked (private mode). Each tab then times out on its own.
  }
}

/**
 * Calls onTimeout after `minutes` with no input in any tab of this app. The
 * last activity time is shared through localStorage, so an idle tab doesn't
 * sign out someone working in another. `warning` turns true for the last
 * `warnSeconds` so the UI can offer to stay signed in.
 */
export function useIdleTimeout(minutes: number, onTimeout: () => void, warnSeconds = 60) {
  const [warning, setWarning] = useState(false);
  const last = useRef(Date.now());
  const lastWritten = useRef(0);
  const cb = useRef(onTimeout);
  cb.current = onTimeout;

  const touch = () => {
    const now = Date.now();
    last.current = now;
    // mousemove fires constantly; a write every few seconds is plenty.
    if (now - lastWritten.current > 5000) {
      lastWritten.current = now;
      writeShared(now);
    }
  };

  useEffect(() => {
    const limit = minutes * 60_000;
    touch();
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      const newest = Math.max(last.current, readShared());
      const idle = Date.now() - newest;
      if (idle >= limit) {
        cb.current();
      } else {
        setWarning(idle >= limit - warnSeconds * 1000);
      }
    }, 5000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, warnSeconds]);

  return {
    warning,
    stayActive: () => {
      lastWritten.current = 0;
      touch();
      setWarning(false);
    },
  };
}
