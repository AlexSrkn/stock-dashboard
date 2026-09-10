import type http from "node:http";
import { buildLandingPreview, type LandingPreviewPayload } from "../landing/buildLandingPreview.js";

const ROUTE_RE = /^\/api\/landing\/preview\/?$/;
const MEMORY_TTL_MS = 60_000;

let memory: { at: number; payload: LandingPreviewPayload } | null = null;
let inflight: Promise<LandingPreviewPayload> | null = null;

function json(res: http.ServerResponse, status: number, body: unknown, cacheSeconds = 60) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${cacheSeconds}`,
  });
  res.end(JSON.stringify(body));
}

async function getPreview(): Promise<LandingPreviewPayload> {
  if (memory && Date.now() - memory.at < MEMORY_TTL_MS) return memory.payload;
  if (inflight) return inflight;
  inflight = buildLandingPreview()
    .then((payload) => {
      memory = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function tryHandleLandingPreview(
  url: URL,
  res: http.ServerResponse
): Promise<boolean> {
  if (!ROUTE_RE.test(url.pathname)) return false;
  try {
    const payload = await getPreview();
    json(res, 200, payload, 60);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("DATABASE_URL")) {
      json(res, 503, { error: "database_unavailable", message });
      return true;
    }
    json(res, 500, { error: "landing_preview_error", message });
  }
  return true;
}
