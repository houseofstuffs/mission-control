"use client";

/**
 * Renders a timestamp in the reader's own timezone, in the house format.
 *
 * Server and client disagree about "now" — the server has no idea what
 * timezone you're in — so the first paint uses the UTC-stable form (matching
 * what the server rendered, no hydration mismatch) and it corrects to local
 * time once mounted.
 */
import { useEffect, useState } from "react";
import { stamp } from "@/lib/dates";

export function TimeStamp({ iso }: { iso: string }) {
  const [text, setText] = useState(() => stamp(iso, true));
  useEffect(() => setText(stamp(iso)), [iso]);
  return <>{text}</>;
}
