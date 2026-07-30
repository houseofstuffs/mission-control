"use client";

/**
 * The standing constraints that go on the end of every image-gen prompt.
 *
 * Generation happens in Kittl, not here — so this is a copy-paste aid, not an
 * API call. Nothing auto-injects it; you copy it and paste it after the image
 * prompt. Shown at C2 because that's where the prompt gets used.
 */
import { STANDING_PROMPT_CONSTRAINTS } from "@/config/design-prompt";
import { CopyIconButton } from "./CopyIconButton";
import { Kicker } from "./ui";

export function StandingConstraints() {
  return (
    <div className="card supporting">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Kicker>ADD TO EVERY IMAGE PROMPT</Kicker>
        <CopyIconButton text={STANDING_PROMPT_CONSTRAINTS} label="standing constraints" />
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          font: "inherit",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        {STANDING_PROMPT_CONSTRAINTS}
      </pre>
      <div className="hint">Magenta knocks out cleanly. Charcoal-brown survives the knockout; pure black doesn&apos;t.</div>
    </div>
  );
}
