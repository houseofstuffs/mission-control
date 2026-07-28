/**
 * Anthropic client — server-side only; the key never reaches the browser.
 *
 * Per the project spec (§11): "Claude Projects have no API — prompts live in
 * the dashboard and call the Anthropic API directly." This is that path.
 */
import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in your host's environment variables (console.anthropic.com to create one)."
    );
  }
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Overridable, but the default is the current most capable model. */
export function model(): string {
  return process.env.ANTHROPIC_MODEL || "claude-opus-5";
}
