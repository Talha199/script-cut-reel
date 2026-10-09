// Shared helpers. Every script works on a project directory: --project <dir>, default cwd.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export const args = parseArgs();
export const root = path.resolve(typeof args.project === "string" ? args.project : process.cwd());
export const p = (...parts) => path.join(root, ...parts);

// trimStart() also drops a UTF-8 BOM (Windows PowerShell 5.1 writes one with -Encoding utf8).
export const readJson = (rel) => JSON.parse(fs.readFileSync(p(rel), "utf8").trimStart());
export const writeJson = (rel, data) => fs.writeFileSync(p(rel), JSON.stringify(data, null, 2) + "\n", "utf8");
export const exists = (rel) => fs.existsSync(p(rel));
