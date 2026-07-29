"use client";

/**
 * Textarea that grows to fit its content — long prompts are read in full,
 * never trapped behind a three-row scrollbar. Used by every generated-text
 * review surface (capture form, style detail, apply panel).
 */
import { useEffect, useRef } from "react";

export function AutoTextarea({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      className="textarea"
      rows={1}
      style={{ overflow: "hidden", resize: "none", minHeight: 40 }}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
