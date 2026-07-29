import { NextResponse } from "next/server";
import { cachedRecord, updateRecord } from "@/server/notion/store";
import { uploadFileToNotion } from "@/server/notion/upload";
import type { SimpleValue } from "@/server/notion/props";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Design field edits from the dashboard — currently C2's artwork capture:
 * a lightweight snapshot (multipart) and/or the link to the master file.
 * The master lives in Drive/S3 per spec §3.6; the snapshot powers Kanban
 * thumbnails and downstream visual reference.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const design = cachedRecord(id);
    if (!design || design.dbKey !== "designs") {
      return NextResponse.json({ error: "Design not found in cache — refresh first" }, { status: 404 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    const values: Record<string, SimpleValue> = {};

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const link = form.get("artworkLink");
      if (typeof link === "string") values["Master PNG Link"] = link || null;
      const winningModel = form.get("winningModel");
      if (typeof winningModel === "string") values["Winning Model"] = winningModel || null;
      const snapshot = form.get("snapshot");
      if (snapshot && typeof snapshot !== "string" && snapshot.size > 0) {
        if (!snapshot.type.startsWith("image/")) {
          return NextResponse.json({ error: "The snapshot must be an image." }, { status: 400 });
        }
        if (snapshot.size > 5 * 1024 * 1024) {
          return NextResponse.json({ error: "Snapshots should be under 5MB — it's a preview, not the master." }, { status: 400 });
        }
        const upload = await uploadFileToNotion(snapshot);
        values["Artwork Snapshot"] = [{ name: snapshot.name, uploadId: upload.id }];
      }
    } else {
      const body = await req.json();
      if (body.artworkLink !== undefined) values["Master PNG Link"] = body.artworkLink ? String(body.artworkLink) : null;
      // primary product assignable from the runner — master canvas rides along,
      // same as at creation (§5.1: canvas comes from the product's print areas)
      if (body.productId !== undefined) {
        if (body.productId) {
          const product = cachedRecord(String(body.productId));
          if (!product || product.dbKey !== "products") {
            return NextResponse.json({ error: "Product not found in cache — refresh first" }, { status: 400 });
          }
          values["Primary Product"] = [product.id];
          if (product.props["Print Areas (JSON)"]) {
            values["Master Canvas (JSON)"] = String(product.props["Print Areas (JSON)"]);
          }
        } else {
          values["Primary Product"] = [];
        }
      }
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    const record = await updateRecord("designs", id, values);
    return NextResponse.json({ record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
