/**
 * Workflow definitions — Creative (C1–C11) and Listing (L1–L7).
 *
 * Backtracking is a first-class path (spec §10, Phase 1). Dependencies are
 * PER-STEP, not "everything after this point": redoing C8 stales retrofits
 * and mockups but not title and tags — coarse warnings get ignored.
 *
 * `dependsOn` lists the steps whose PRODUCES this step consumes. When a step
 * is redone, every done/downstream step reachable through dependsOn edges is
 * marked stale — stale ≠ unchecked, so you always know what you've re-done.
 *
 * L8 (bundle listings) is deliberately absent: it's a separate path that
 * creates a NEW listing from published designs, not a step in this sequence.
 * R1–R7 (research) arrives with CSV import in Phase 2.
 */

export type StepStatus = "pending" | "done" | "stale" | "blocked";

export interface StepDef {
  id: string;
  /** lowercase label for the step rail (build spec §4 step rail) */
  label: string;
  title: string;
  needs: string[];
  produces: string[];
  /** step ids whose outputs this step consumes */
  dependsOn: string[];
  note?: string;
}

export interface WorkflowDef {
  key: "creative" | "listing";
  name: string;
  steps: StepDef[];
}

export const CREATIVE_WORKFLOW: WorkflowDef = {
  key: "creative",
  name: "Creative",
  steps: [
    {
      id: "C1",
      label: "input branch",
      title: "Input branch",
      needs: ["Greenlit niche", "Concept (artwork ref, copy, or template)", "Style record (optional)"],
      produces: ["Image prompt + text prompt pair", "Texture shortlist (chosen now, not mid-flow)"],
      dependsOn: [],
      note: "Three starting points — artwork reference, copy first, or Kittl/PODSpy template — converging at C2.",
    },
    {
      id: "C2",
      label: "image gen",
      title: "Image generation",
      needs: ["Image prompt", "Master canvas ratio (from Primary Product)"],
      produces: ["Selected image (2 options × 4 models, 8 max)"],
      dependsOn: ["C1"],
      note: "Kittl, image-generate not agentic. Artboard at master canvas ratio — ratio is the generation constraint.",
    },
    {
      id: "C3",
      label: "text gen",
      title: "Text generation",
      needs: ["Text prompt"],
      produces: ["Selected text treatment (coloring adjusted)"],
      dependsOn: ["C1"],
      note: "Text as a Kittl layer, not in-image, wherever spelling matters.",
    },
    {
      id: "C4",
      label: "combine",
      title: "Combine image + text",
      needs: ["Selected image", "Selected text"],
      produces: ["Combined composition"],
      dependsOn: ["C2", "C3"],
    },
    {
      id: "C5",
      label: "texture",
      title: "Texture",
      needs: ["Combined composition", "Texture shortlist (from concept stage)"],
      produces: ["Textured composition (intensity variants rendered in one pass)"],
      dependsOn: ["C4"],
      note: "Semantic matching matters. Texture reads differently across colorways — intensity may be variant-level.",
    },
    {
      id: "C6",
      label: "route",
      title: "Route by texture source",
      needs: ["Texture source (Kittl vs owned file)"],
      produces: ["Export path decision (Kittl→Photoshop, or straight to Photoshop)"],
      dependsOn: ["C5"],
    },
    {
      id: "C7",
      label: "uprez + knockout",
      title: "Uprez + remove background",
      needs: ["Exported composition"],
      produces: ["Print-resolution artwork, background removed"],
      dependsOn: ["C6"],
      note: "Two separate operations, not \"enhance\". Uprez happens in Kittl before Photoshop. Order (uprez-then-knockout vs reverse) still to confirm for cleaner edges.",
    },
    {
      id: "C8",
      label: "refine",
      title: "Photoshop refinement",
      needs: ["Print-resolution artwork"],
      produces: ["Refined artwork (artifacts cut/filled, edges cleaned)"],
      dependsOn: ["C7"],
    },
    {
      id: "C9",
      label: "save psd",
      title: "Save PSD master",
      needs: ["Refined artwork"],
      produces: ["PSD master in Drive (link on record)", "PSD saved date"],
      dependsOn: ["C8"],
      note: "The PSD is the master asset. Every PNG is a disposable derivative.",
    },
    {
      id: "C10",
      label: "validate",
      title: "Validation gate",
      needs: ["PSD master", "Primary Product print specs"],
      produces: ["Printify product for primary product", "Verified print mock (bleed + margins)", "Sample decision"],
      dependsOn: ["C9"],
      note: "Primary product ONLY. Validate before you multiply — a backtrack invalidates one retrofit instead of six.",
    },
    {
      id: "C11",
      label: "fan out",
      title: "Fan out",
      needs: ["Passed validation gate", "Remaining product print specs"],
      produces: ["Retrofits across the product line (scaling scripted, recomposition by hand)"],
      dependsOn: ["C10"],
    },
  ],
};

export const LISTING_WORKFLOW: WorkflowDef = {
  key: "listing",
  name: "Listing",
  steps: [
    {
      id: "L1",
      label: "printify product",
      title: "Create Printify product",
      needs: ["Validated design (C10 passed)", "Product (blueprint × provider)"],
      produces: ["Printify product with variants (primary done at C10; variations here)"],
      dependsOn: [],
    },
    {
      id: "L2",
      label: "write listing",
      title: "Write the listing",
      needs: ["Curated keyword bank (Niche record)", "Product boilerplate", "Shop voice"],
      produces: ["Title (<15 words)", "13 tags", "Attributes", "Description hook + body copy", "Screenable phrases"],
      dependsOn: [],
      note: "Independent of L1 — copy doesn't consume the Printify product.",
    },
    {
      id: "L3",
      label: "verify pricing",
      title: "Verify pricing + shipping profile",
      needs: ["Price set at R6", "Shipping profile"],
      produces: ["Verified price and shipping (verification, not decision)"],
      dependsOn: ["L1"],
    },
    {
      id: "L4",
      label: "images",
      title: "Generate images",
      needs: ["Printify product", "PSD master", "Mockup templates", "Brand record"],
      produces: ["Product mockups", "Branded info graphics"],
      dependsOn: ["L1"],
      note: "Mockups are a compositing problem, not a generation problem — hosted PSD rendering in Phase 3.",
    },
    {
      id: "L5",
      label: "image slots",
      title: "Assemble image slots",
      needs: ["Generated images", "Per-product-type slot template (20 slots)"],
      produces: ["Ordered image set — slot one is the search thumbnail"],
      dependsOn: ["L4"],
    },
    {
      id: "L6",
      label: "publish gates",
      title: "Publish gates",
      needs: ["Everything below — all must pass"],
      produces: [
        "Title, tags, attributes, description present",
        "Required image slots filled in order",
        "Size chart image present if description cites it",
        "Trademark screening confirmed complete",
        "Cost snapshot recorded",
      ],
      dependsOn: ["L2", "L3", "L5"],
    },
    {
      id: "L7",
      label: "push draft",
      title: "Push to Etsy as complete draft",
      needs: ["All L6 gates passed"],
      produces: ["Complete Etsy draft (finish + publish in Shop Manager)"],
      dependsOn: ["L6"],
      note: "Sequenced LAST so Printify's hide-from-Etsy checkbox stops being load-bearing. Draft-only in v1.",
    },
  ],
};

export const WORKFLOWS: Record<string, WorkflowDef> = {
  creative: CREATIVE_WORKFLOW,
  listing: LISTING_WORKFLOW,
};

export function workflowForDbKey(dbKey: string): WorkflowDef {
  if (dbKey === "designs") return CREATIVE_WORKFLOW;
  if (dbKey === "etsy_listings") return LISTING_WORKFLOW;
  throw new Error(`No workflow for db "${dbKey}"`);
}

export function stepIndex(wf: WorkflowDef, stepId: string): number {
  const i = wf.steps.findIndex((s) => s.id === stepId);
  if (i === -1) throw new Error(`Unknown step ${stepId} in ${wf.key}`);
  return i;
}

/**
 * All steps downstream of `fromStep` through dependsOn edges — the set marked
 * stale when `fromStep` is redone. Per-step, not positional.
 */
export function downstreamOf(wf: WorkflowDef, fromStep: string): string[] {
  const out = new Set<string>();
  let frontier = [fromStep];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const step of wf.steps) {
      if (out.has(step.id)) continue;
      if (step.dependsOn.some((d) => frontier.includes(d) || out.has(d))) {
        out.add(step.id);
        next.push(step.id);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return wf.steps.filter((s) => out.has(s.id)).map((s) => s.id);
}

/** Kanban stages for the Designs board — groups of creative steps. */
export const KANBAN_STAGES: Array<{ key: string; label: string; steps: string[] }> = [
  { key: "concept", label: "Concept", steps: ["C1"] },
  { key: "generate", label: "Generate", steps: ["C2", "C3", "C4"] },
  { key: "texture", label: "Texture", steps: ["C5", "C6"] },
  { key: "refine", label: "Refine", steps: ["C7", "C8", "C9"] },
  { key: "validate", label: "Validate", steps: ["C10"] },
  { key: "fanout", label: "Fan out", steps: ["C11"] },
  { key: "done", label: "Done", steps: ["Done"] },
];
