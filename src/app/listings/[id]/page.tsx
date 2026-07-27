import Link from "next/link";
import { notFound } from "next/navigation";
import { cachedRecord } from "@/server/notion/store";
import { runnerRecord } from "@/server/viewmodels";
import { StepRunner } from "@/components/StepRunner";
import { Kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ListingRunnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = cachedRecord(id);
  if (!rec || rec.dbKey !== "etsy_listings") notFound();

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <Kicker><Link href="/listings">LISTINGS</Link> / LISTING WORKFLOW · DRAFT-ONLY</Kicker>
          <h1 className="page-title" style={{ textTransform: "none", letterSpacing: 0 }}>{rec.title || "Untitled listing"}</h1>
        </div>
      </div>
      <StepRunner record={runnerRecord(rec)} />
    </div>
  );
}
