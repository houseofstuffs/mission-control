/**
 * Workflow definitions — Creative (C1–C9) and Listing (L1–L7).
 *
 * Backtracking is a first-class path (spec §10, Phase 1). Dependencies are
 * PER-STEP, not "everything after this point": redoing C7 stales retrofits
 * and mockups but not title and tags — coarse warnings get ignored.
 *
 * `dependsOn` lists the steps whose PRODUCES this step consumes. When a step
 * is redone, every done/downstream step reachable through dependsOn edges is
 * marked stale — stale ≠ unchecked, so you always know what you've re-done.
 *
 * Creative was C1–C11 in the project spec; two pairs merged (routing into
 * Texture, saving the PSD into Refine) and uprez+knockout moved ahead of
 * Texture, so validation is C8 and fan-out C9. C1–C4 kept their meanings.
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
      label: "input",
      title: "Input",
      needs: ["Greenlit niche", "Concept (artwork ref, copy, or template)", "Style record (optional)"],
      produces: ["Image prompt + text prompt pair", "Texture shortlist (chosen now, not mid-flow)"],
      dependsOn: [],
      note: "Three starting points — artwork reference, copy first, or a Kittl/PODSpy template — converging at C2.",
    },
    {
      id: "C2",
      label: "image gen",
      title: "Image generation",
      needs: ["Image prompt", "Master canvas ratio (from Primary Product)"],
      produces: [
        "2-3 styles (1 img gen each)",
        "4-5 rounds max on selected",
        "Selected image",
      ],
      dependsOn: ["C1"],
      note: "Image-generate, not agentic. Artboard at master canvas ratio — the ratio is the generation constraint.",
    },
    {
      id: "C3",
      label: "text gen",
      title: "Text generation",
      needs: ["Text prompt"],
      produces: ["Selected text treatment (coloring adjusted)"],
      dependsOn: ["C1"],
      note: "Text as its own layer, never generated in-image, wherever spelling matters.",
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
      // Before texture: upscaling interpolates, and grain is exactly the
      // high-frequency detail an upscaler smooths away. Clean edges also
      // knock out far more cleanly than distressed, semi-transparent ones.
      id: "C5",
      label: "uprez + knockout",
      title: "Uprez + remove background",
      needs: ["Combined composition"],
      produces: ["Print-resolution artwork, background removed (transparent)"],
      dependsOn: ["C4"],
      note: "Two separate operations, not \"enhance\". Uprez first so the texture that follows sits at true print scale — texturing before an upscale turns the grain to mush.",
    },
    {
      // Absorbed the old routing step: with texture applied here by default,
      // the Kittl-vs-Photoshop decision had one branch. Further texture work
      // is refinement at C7.
      id: "C6",
      label: "texture",
      title: "Texture",
      needs: ["Print-resolution transparent artwork", "Texture shortlist (from concept stage)"],
      produces: ["Textured transparent PNG, exported for refinement"],
      dependsOn: ["C5"],
      note: "Applied as a layer over the knocked-out artwork — mask when the grain should eat the edges, overlay when it shouldn't. Texture reads differently across colorways, so intensity may be variant-level.",
    },
    {
      // Refine and save the file you just refined: one pass at the desk.
      id: "C7",
      label: "refine psd",
      title: "Refine PSD",
      needs: ["Textured transparent PNG"],
      produces: [
        "Refined artwork (artifacts cut/filled, edges cleaned, texture enhanced)",
        "PSD master + linked to Gdrive",
        "Transparent PNG master + linked to Gdrive",
      ],
      dependsOn: ["C6"],
      note: "The PSD is the master asset. Every PNG is a disposable derivative.",
    },
    {
      id: "C8",
      label: "validate",
      title: "Validation gate",
      needs: ["PSD master", "Primary product print specs"],
      produces: ["Printify listing for primary product", "Verified print mock (bleed + margins)", "Order sample or skip"],
      dependsOn: ["C7"],
      note: "Primary product ONLY. Validate before you multiply.",
    },
    {
      id: "C9",
      label: "fan out",
      title: "Fan out",
      needs: ["Passed validation gate", "Remaining product print specs"],
      produces: ["Retrofits across the product line (scaling scripted, recomposition by hand)"],
      dependsOn: ["C8"],
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
      needs: ["Validated design (C8 passed)", "Product (blueprint × provider)"],
      produces: ["Printify product with variants (primary done at C8; variations here)"],
      dependsOn: [],
    },
    {
      id: "L2",
      label: "write listing",
      title: "Write the listing",
      needs: ["Curated keyword bank (Niche record)", "Product boilerplate", "Shop voice"],
      produces: [
        "Title (<15 words)",
        "13 tags",
        "Attributes",
        "Description (hook in shop voice + product boilerplate)",
        "Screenable phrases — the new text a trademark screen has to clear",
      ],
      dependsOn: [],
      note: "Independent of L1 — copy doesn't consume the Printify product.",
    },
    {
      id: "L3",
      label: "verify pricing",
      title: "Verify pricing + shipping profile",
      needs: ["Cost snapshot (from the product's estimate)", "Shipping profile"],
      produces: ["Saved price with verified margin (Etsy fees itemized)", "Shipping profile confirmed"],
      dependsOn: ["L1"],
      note: "No cost, no math — the calculator refuses rather than showing a $0 cost.",
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

/**
 * Kanban stages for the Designs board — a DISPLAY grouping over C1–C9, five
 * columns wide so the board doesn't run off the side of the screen.
 *
 * Bundling costs nothing here. Staleness and backtracking are still computed
 * per-step in the runner, which keeps all nine: the reason C2–C6 stayed
 * separate there — redoing texture must not re-flag the upscale — has no
 * bearing on how many columns a board draws. Artwork is everything from the
 * first generation to the textured export, which is one sitting anyway.
 */
export const KANBAN_STAGES: Array<{ key: string; label: string; steps: string[] }> = [
  { key: "concept", label: "Concept", steps: ["C1"] },
  { key: "artwork", label: "Artwork", steps: ["C2", "C3", "C4", "C5", "C6"] },
  { key: "refine", label: "Refine", steps: ["C7"] },
  { key: "validate", label: "Validate", steps: ["C8"] },
  { key: "fanout", label: "Fan out", steps: ["C9"] },
];
