/**
 * Step-state engine for the step runner.
 *
 * State shape (stored as JSON in the record's "Step State (JSON)" property —
 * Notion is the system of record; the cache just mirrors it):
 *   { steps: { C1: { status, note?, at? }, ... }, current: "C4" }
 *
 * Every transition is logged to the Workflow Log database. Backtracks record
 * which step, from where, why, and exactly which steps went stale.
 */
import {
  workflowForDbKey,
  downstreamOf,
  stepIndex,
  type StepStatus,
  type WorkflowDef,
} from "@/lib/workflows";
import { cachedRecord, createRecord, updateRecord } from "@/server/notion/store";
import { compatForListing } from "@/server/imageSlots";
import type { SimpleRecord, SimpleValue } from "@/server/notion/props";

export interface StepEntry {
  status: StepStatus;
  note?: string;
  at?: string;
}
export interface StepState {
  steps: Record<string, StepEntry>;
  current: string;
}

export function parseStepState(rec: SimpleRecord): StepState {
  const wf = workflowForDbKey(rec.dbKey);
  const raw = rec.props["Step State (JSON)"];
  let state: StepState | null = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      state = JSON.parse(raw) as StepState;
    } catch {
      state = null;
    }
  }
  if (!state || !state.steps) {
    state = { steps: {}, current: wf.steps[0].id };
  }
  for (const step of wf.steps) {
    if (!state.steps[step.id]) state.steps[step.id] = { status: "pending" };
  }
  if (!wf.steps.some((s) => s.id === state!.current) && state.current !== "Done" && state.current !== "Pushed") {
    state.current = wf.steps[0].id;
  }
  return state;
}

function terminalStatus(wf: WorkflowDef): string {
  return wf.key === "creative" ? "Done" : "Pushed";
}

function flags(state: StepState) {
  const statuses = Object.values(state.steps).map((s) => s.status);
  return {
    hasStale: statuses.includes("stale"),
    hasBlocked: statuses.includes("blocked"),
  };
}

async function persist(rec: SimpleRecord, state: StepState): Promise<SimpleRecord> {
  const f = flags(state);
  return updateRecord(rec.dbKey, rec.id, {
    "Step State (JSON)": JSON.stringify(state),
    "Current Step": state.current,
    "Has Stale": f.hasStale,
    "Has Blocked": f.hasBlocked,
  });
}

async function log(
  rec: SimpleRecord,
  event: string,
  fields: { fromStep?: string; toStep?: string; reason?: string; stale?: string[] }
): Promise<void> {
  const values: Record<string, SimpleValue> = {
    Name: `${rec.title || "Untitled"} — ${event}`,
    Event: event,
    "From Step": fields.fromStep ?? "",
    "To Step": fields.toStep ?? "",
    Reason: fields.reason ?? "",
    "Steps Marked Stale": (fields.stale ?? []).join(", "),
    At: new Date().toISOString(),
  };
  if (rec.dbKey === "designs") values["Design"] = [rec.id];
  if (rec.dbKey === "etsy_listings") values["Listing"] = [rec.id];
  await createRecord("workflow_log", values);
}

function requireRecord(pageId: string): SimpleRecord {
  const rec = cachedRecord(pageId);
  if (!rec) throw new Error("Record not in cache — refresh first.");
  return rec;
}

/**
 * Hard requirements — a step whose whole job is to produce an artifact can't
 * be marked done without it. Advisory gates live in the gate panel; these
 * BLOCK, and they block server-side so a stale page can't slip past them.
 */
export function unmetRequirement(rec: SimpleRecord, stepId: string): string | null {
  if (rec.dbKey === "etsy_listings") {
    // The publish gate is where an unexamined design stops being harmless:
    // it decides which garment colours ship. No default is safe here.
    if ((stepId === "L6" || stepId === "L7") && compatForListing(rec) === "Unset") {
      return "Garment compatibility not set.";
    }
    // Dimensional products have no honest cost without their anchor size —
    // and a listing priced without a cost is a margin decided by accident.
    if (stepId === "L6" || stepId === "L7") {
      const productId = ((rec.props["Product"] as string[] | null) ?? [])[0];
      const product = productId ? cachedRecord(productId) : null;
      if (
        product &&
        String(product.props["Category"] ?? "") === "wall_art" &&
        ((product.props["Representative Variant"] as string[] | null) ?? []).length === 0
      ) {
        return "Needs representative size — pick it on the product card.";
      }
    }
    return null;
  }
  if (rec.dbKey !== "designs") return null;
  const has = (prop: string) => {
    const v = rec.props[prop];
    return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : Boolean(v);
  };
  if (stepId === "C2" && !has("Artwork Snapshot")) {
    return "Drop a snapshot of the selected generation before moving to the next step.";
  }
  if (stepId === "C7") {
    if (!has("PSD Master Link")) return "Save the PSD master link before moving to the next step.";
    if (!has("Master PNG Link")) return "Save the master PNG link before moving to the next step.";
  }
  return null;
}

/**
 * Mark specific DONE steps stale without moving the current pointer — for
 * when an upstream INPUT changes through an edit rather than a backtrack
 * (e.g. colourways change after images were made). Pending/blocked steps
 * are left alone; nothing is ever unchecked.
 */
export async function markStepsStale(pageId: string, stepIds: string[], note: string): Promise<void> {
  const rec = requireRecord(pageId);
  const state = parseStepState(rec);
  const now = new Date().toISOString();
  const staled: string[] = [];
  for (const id of stepIds) {
    if (state.steps[id]?.status === "done") {
      state.steps[id] = { status: "stale", at: now, note };
      staled.push(id);
    }
  }
  if (staled.length === 0) return;
  await persist(rec, state);
  await log(rec, "Marked stale", { reason: note, stale: staled });
}

/** Mark the current (or given) step done and advance to the next actionable step. */
export async function markStepDone(pageId: string, stepId?: string): Promise<SimpleRecord> {
  const rec = requireRecord(pageId);
  const wf = workflowForDbKey(rec.dbKey);
  const state = parseStepState(rec);
  const id = stepId ?? state.current;
  const unmet = unmetRequirement(rec, id);
  if (unmet) throw new Error(unmet);
  const now = new Date().toISOString();

  state.steps[id] = { status: "done", at: now };

  // advance: next step (in rail order) that isn't done; else terminal
  const idx = stepIndex(wf, id);
  const next = wf.steps.slice(idx + 1).find((s) => state.steps[s.id].status !== "done");
  const before = state.current;
  state.current = next ? next.id : terminalStatus(wf);

  const updated = await persist(rec, state);
  await log(rec, "Step done", { fromStep: before, toStep: state.current });
  return updated;
}

/**
 * Backtrack — a first-class, non-destructive path. Returns to `toStep`,
 * reopens it, and marks every DONE step that depends on it (transitively,
 * per-step graph) as stale. Nothing is unchecked: stale ≠ pending.
 */
export async function backtrack(pageId: string, toStep: string, reason: string): Promise<SimpleRecord> {
  const rec = requireRecord(pageId);
  const wf = workflowForDbKey(rec.dbKey);
  const state = parseStepState(rec);
  const from = state.current;
  const now = new Date().toISOString();

  const downstream = downstreamOf(wf, toStep);
  const staled: string[] = [];
  for (const id of downstream) {
    if (state.steps[id].status === "done") {
      state.steps[id] = { status: "stale", at: now, note: `Stale since backtrack to ${toStep}` };
      staled.push(id);
    }
  }
  state.steps[toStep] = { status: "pending", at: now };
  state.current = toStep;

  const updated = await persist(rec, state);
  await log(rec, "Backtrack", { fromStep: from, toStep, reason, stale: staled });
  return updated;
}

/** "Still valid" — first-class action on a stale step: confirm without redoing. */
export async function stillValid(pageId: string, stepId: string): Promise<SimpleRecord> {
  const rec = requireRecord(pageId);
  const state = parseStepState(rec);
  if (state.steps[stepId]?.status !== "stale") {
    throw new Error(`${stepId} is not stale`);
  }
  state.steps[stepId] = { status: "done", at: new Date().toISOString(), note: "Confirmed still valid" };

  // if nothing is pending/stale before current, keep current where it is
  const updated = await persist(rec, state);
  await log(rec, "Still valid", { toStep: stepId });
  return updated;
}

/** Block / unblock a step. Copy should always name the unblocking condition. */
export async function setBlocked(
  pageId: string,
  stepId: string,
  blocked: boolean,
  reason?: string
): Promise<SimpleRecord> {
  const rec = requireRecord(pageId);
  const state = parseStepState(rec);
  const now = new Date().toISOString();
  state.steps[stepId] = blocked
    ? { status: "blocked", at: now, note: reason ?? "" }
    : { status: "pending", at: now };
  const updated = await persist(rec, state);
  await log(rec, blocked ? "Blocked" : "Unblocked", { toStep: stepId, reason });
  return updated;
}

/** Jump the current pointer to a specific step (used by Kanban drag). Forward
 * jumps mark skipped-over steps done only if explicitly requested — default
 * is to move the pointer without faking completion. Backward jumps route
 * through backtrack() so staleness and logging stay honest. */
export async function moveToStep(pageId: string, toStep: string, reason?: string): Promise<SimpleRecord> {
  const rec = requireRecord(pageId);
  const wf = workflowForDbKey(rec.dbKey);
  const state = parseStepState(rec);
  const fromIdx =
    state.current === terminalStatus(wf) ? wf.steps.length : stepIndex(wf, state.current);
  const toIdx = stepIndex(wf, toStep);
  if (toIdx < fromIdx) {
    return backtrack(pageId, toStep, reason ?? "Moved back on board");
  }
  const before = state.current;
  state.current = toStep;
  const updated = await persist(rec, state);
  await log(rec, "Moved", { fromStep: before, toStep, reason: reason ?? "Moved on board" });
  return updated;
}
