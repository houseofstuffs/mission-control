import { NextResponse } from "next/server";
import { cachedRecord, cachedRecords, createRecord, updateRecord } from "@/server/notion/store";
import { composeCandidates, type Candidate } from "@/server/anthropic/apply";
import { anthropicConfigured } from "@/server/anthropic/client";
import {
  createComposeJob,
  getComposeJob,
  completeComposeJob,
  failComposeJob,
} from "@/server/cache/composeJobs";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Style fields the composer needs, in the order it should read them. */
const STYLE_FIELDS = [
  "Description",
  "Composition",
  "Slots",
  "Typography",
  "Reusable Prompt",
  "Type Prompt",
  "Rule of Thumb",
];

/** A stored candidate: what the composer returned plus its library id. */
export interface StoredCandidate extends Candidate {
  styleId: string | null;
}

/**
 * Apply mode. Two operations:
 *
 * compose — 1-5 library styles + optional suggested directions → candidates.
 * The full set writes to the design's Prompt Candidates (JSON) immediately:
 * the winner is picked at C2 after real generations, so the candidates must
 * survive the trip to Kittl and back.
 *
 * commit — one candidate wins: its pair lands in Image/Text Prompt and
 * Texture Note, and the Style relation is set when it's a library style.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const design = cachedRecord(String(body.designId ?? ""));
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 404 });
    }

    // ---- spin a candidate off as its own design ----
    // Two winners on one design would make C4-C11 ambiguous about which
    // composition they mean; a second winner is a second design. It clones
    // the source's context, carries the candidate's pair, and starts at C2
    // with C1 done — its artwork direction is already chosen.
    if (body.spinOff) {
      const c = body.spinOff as Partial<StoredCandidate>;
      const values: Record<string, SimpleValue> = {
        Name: `${design.title || "Untitled"} — ${c.styleName ?? "variant"}`,
        "Current Step": "C2",
        "Step State (JSON)": JSON.stringify({
          steps: { C1: { status: "done", at: new Date().toISOString() } },
          current: "C2",
        }),
        "Physical/Digital": String(design.props["Physical/Digital"] ?? "Physical"),
        Shop: "STUFFS",
        Channel: "Etsy",
        "External IDs (JSON)": "{}",
        "Image Prompt": c.imagePrompt ?? "",
        "Text Prompt": c.textPrompt ?? "",
        "Texture Note": c.textureNote ?? "",
      };
      for (const rel of ["Niche", "Collection", "Primary Product"] as const) {
        const ids = design.props[rel] as string[] | null;
        if (ids?.length) values[rel] = ids;
      }
      if (design.props["Master Canvas (JSON)"]) {
        values["Master Canvas (JSON)"] = String(design.props["Master Canvas (JSON)"]);
      }
      if (design.props["Occasion"]) values["Occasion"] = String(design.props["Occasion"]);
      if (design.props["Occasion Date"]) values["Occasion Date"] = String(design.props["Occasion Date"]);
      if (c.styleId) values["Style"] = [c.styleId];

      const record = await createRecord("designs", values);
      // Mark the source candidate as spun off — ON THE RECORD, not in page
      // state, so coming back to the board still shows which prompt left.
      const rawCandidates = String(design.props["Prompt Candidates (JSON)"] ?? "");
      if (rawCandidates.trim()) {
        try {
          const list = JSON.parse(rawCandidates);
          if (Array.isArray(list)) {
            const idx = list.findIndex(
              (x) => x?.imagePrompt === c.imagePrompt && x?.styleName === c.styleName
            );
            if (idx >= 0) {
              list[idx].spunOffTo = { id: record.id, title: record.title };
              await updateRecord("designs", design.id, {
                "Prompt Candidates (JSON)": JSON.stringify(list),
              });
            }
          }
        } catch {
          /* unparseable candidates — the spin-off itself still stands */
        }
      }
      await createRecord("workflow_log", {
        Name: `${record.title} — Created new`,
        Event: "Created new",
        Design: [record.id],
        "To Step": "C2",
        Reason: `Spun off from "${design.title}" — candidate "${c.styleName}"`,
        At: new Date().toISOString(),
      });
      return NextResponse.json({ record });
    }

    // ---- commit the winner ----
    if (body.commit) {
      const c = body.commit as Partial<StoredCandidate>;
      const values: Record<string, SimpleValue> = {
        "Image Prompt": c.imagePrompt ?? "",
        "Text Prompt": c.textPrompt ?? "",
        "Texture Note": c.textureNote ?? "",
      };
      if (c.styleId) values["Style"] = [c.styleId];
      const record = await updateRecord("designs", design.id, values);
      return NextResponse.json({ record });
    }

    // ---- compose candidates ----
    if (!anthropicConfigured()) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not set. Add it in your host's environment variables." },
        { status: 400 }
      );
    }
    const styleIds = (body.styleIds as string[] | undefined) ?? [];
    if (styleIds.length < 1 || styleIds.length > 5) {
      return NextResponse.json({ error: "Pick 1-5 styles." }, { status: 400 });
    }
    const suggest = Math.min(2, Math.max(0, Number(body.suggest ?? 0)));

    const styles = styleIds.map((id) => {
      const s = cachedRecord(id);
      if (!s || s.dbKey !== "styles") throw new Error("A selected style is missing from the cache — refresh first.");
      const fields: Record<string, string> = {};
      for (const f of STYLE_FIELDS) fields[f] = String(s.props[f] ?? "");
      return { id, name: s.title, fields };
    });

    // Context the composer should know: niche, product, occasion.
    const parts: string[] = [];
    const nicheId = (design.props["Niche"] as string[] | null)?.[0];
    if (nicheId) {
      const niche = cachedRecords("niches").find((n) => n.id === nicheId);
      if (niche) parts.push(`niche "${niche.title}"`);
    }
    const productId = (design.props["Primary Product"] as string[] | null)?.[0];
    if (productId) {
      const product = cachedRecords("products").find((p) => p.id === productId);
      if (product) parts.push(`primary product "${product.title}"`);
    }
    if (design.props["Occasion"]) parts.push(`occasion ${String(design.props["Occasion"])}`);

    // Job-based: a multi-candidate compose runs for minutes — far past what
    // one web request survives. The job finishes server-side and writes the
    // candidates onto the design; the client polls and refreshes.
    const jobId = createComposeJob(design.id);
    const designId = design.id;
    void composeCandidates({
      styles: styles.map((s) => ({ name: s.name, fields: s.fields })),
      fills: (body.fills as Record<string, string>) ?? {},
      copy: String(body.copy ?? ""),
      context: parts.length ? parts.join(", ") : undefined,
      suggestCount: suggest,
    })
      .then(async (raw) => {
        // Library candidates come back in input order; suggested ones follow.
        const library = raw.filter((c) => !c.suggested);
        const candidates: StoredCandidate[] = raw.map((c) => {
          if (c.suggested) return { ...c, styleId: null };
          const idx = library.indexOf(c);
          return { ...c, styleId: styles[idx]?.id ?? styles.find((s) => s.name === c.styleName)?.id ?? null };
        });
        await updateRecord("designs", designId, {
          "Prompt Candidates (JSON)": JSON.stringify(candidates),
        });
        completeComposeJob(jobId);
      })
      .catch((err) => failComposeJob(jobId, (err as Error).message));

    return NextResponse.json({ jobId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Poll a compose job. */
export async function GET(req: Request) {
  try {
    const jobId = new URL(req.url).searchParams.get("job");
    if (!jobId) return NextResponse.json({ error: "job parameter required" }, { status: 400 });
    const job = getComposeJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found — it may have expired." }, { status: 404 });
    return NextResponse.json({ status: job.status, error: job.error });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
