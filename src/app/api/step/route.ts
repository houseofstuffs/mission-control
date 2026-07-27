import { NextResponse } from "next/server";
import { backtrack, markStepDone, moveToStep, setBlocked, stillValid } from "@/server/steps";

export const dynamic = "force-dynamic";

interface StepAction {
  pageId: string;
  action: "done" | "back" | "still-valid" | "block" | "unblock" | "move";
  step?: string;
  reason?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StepAction;
    if (!body.pageId || !body.action) {
      return NextResponse.json({ error: "pageId and action are required" }, { status: 400 });
    }
    let record;
    switch (body.action) {
      case "done":
        record = await markStepDone(body.pageId, body.step);
        break;
      case "back":
        if (!body.step) return NextResponse.json({ error: "step required" }, { status: 400 });
        // Every backtrack is logged with a reason — that log is what shows
        // where the process leaks after ten designs.
        record = await backtrack(body.pageId, body.step, body.reason ?? "");
        break;
      case "still-valid":
        if (!body.step) return NextResponse.json({ error: "step required" }, { status: 400 });
        record = await stillValid(body.pageId, body.step);
        break;
      case "block":
        if (!body.step) return NextResponse.json({ error: "step required" }, { status: 400 });
        record = await setBlocked(body.pageId, body.step, true, body.reason);
        break;
      case "unblock":
        if (!body.step) return NextResponse.json({ error: "step required" }, { status: 400 });
        record = await setBlocked(body.pageId, body.step, false);
        break;
      case "move":
        if (!body.step) return NextResponse.json({ error: "step required" }, { status: 400 });
        record = await moveToStep(body.pageId, body.step, body.reason);
        break;
      default:
        return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
    }
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
