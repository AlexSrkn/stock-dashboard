import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = path.join(process.cwd(), "data", "cache", "sectors");

function cachePath(name: string): string {
  return path.join(CACHE_DIR, `${name}.json`);
}

export function readSectorDiskCache<T>(name: string, version: number): T | null {
  try {
    const file = cachePath(name);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: number; payload?: T };
    if (!raw || raw.version !== version || raw.payload == null) return null;
    return raw.payload;
  } catch {
    return null;
  }
}

export function writeSectorDiskCache<T>(name: string, version: number, payload: T): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      cachePath(name),
      JSON.stringify({ version, savedAt: new Date().toISOString(), payload }),
      "utf8"
    );
  } catch (err) {
    console.warn(
      `Failed to write sector disk cache ${name}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}
