"use client";

/**
 * Quiet copy affordance — a small clipboard glyph that flips to a check on
 * copy. Sits at the right edge of a field's label row on every generated-text
 * surface; deliberately understated so THE RULE's attention colours stay
 * reserved for actions that matter.
 */
import { useState } from "react";

export function CopyIconButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label ?? "text"}`}
      title={copied ? "Copied" : "Copy"}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        marginLeft: "auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: copied ? "#2e7d5b" : "var(--text-secondary, #8a7a5c)",
        borderRadius: 6,
      }}
    >
      {copied ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 3.5v-.75A1.25 1.25 0 0 0 9.25 1.5h-6A1.25 1.25 0 0 0 2 2.75v6A1.25 1.25 0 0 0 3.25 10H4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
