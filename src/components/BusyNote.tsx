"use client";

/**
 * The app's standard "still working" indication.
 *
 * A spinner alone can't distinguish working from hung — it looks identical
 * either way. This counts up, so motion proves the request is still alive,
 * and after a while it says what's normal for the operation. Every mutation
 * pairs its spinner with one of these.
 */
import { useEffect, useState } from "react";

export function BusyNote({
  active,
  label = "Working",
  /** seconds after which this is genuinely slower than expected */
  patienceSeconds = 25,
}: {
  active: boolean;
  label?: string;
  patienceSeconds?: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;
  return (
    <span className="hint" aria-live="polite">
      {label} — {elapsed}s
      {elapsed >= patienceSeconds ? " · slower than usual, still trying" : ""}
    </span>
  );
}
