import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/server/drive/connection";
import { folderIdFromLink, listFolderImages, ReconnectError } from "@/server/drive/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Lists a folder's images. Classification (colour vs info graphic) runs client-side, where the palette lives. */
export async function GET(req: Request) {
  try {
    const link = new URL(req.url).searchParams.get("link") ?? "";
    const folderId = folderIdFromLink(link);
    if (!folderId) {
      return NextResponse.json({ error: "That doesn't look like a Drive folder link." }, { status: 400 });
    }
    const token = await getValidAccessToken();
    const files = await listFolderImages(folderId, token);
    return NextResponse.json({ files });
  } catch (err) {
    if (err instanceof ReconnectError) {
      return NextResponse.json({ error: err.message, needsReconnect: true }, { status: 401 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
