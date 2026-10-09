// Creates the project layout and fetches fonts (Fontsource, OFL) + GSAP from npm.
//   node <skill>/scripts/setup.mjs [--project <dir>]
// Layout:  assets/{fonts,vendor,sfx}  edit/  out/
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { p, root } from "./lib.mjs";

for (const d of ["assets/fonts", "assets/vendor", "edit", "out"]) fs.mkdirSync(p(d), { recursive: true });

const deps = path.join(os.tmpdir(), "script-cut-reel-deps");
fs.mkdirSync(deps, { recursive: true });
// Own package.json, or npm walks up and installs into whatever parent project it finds.
if (!fs.existsSync(path.join(deps, "package.json"))) fs.writeFileSync(path.join(deps, "package.json"), '{ "name": "script-cut-reel-deps", "private": true }\n');
if (!fs.existsSync(path.join(deps, "node_modules/gsap/dist/gsap.min.js"))) {
  console.log("installing font + gsap packages into", deps);
  execSync("npm install --no-audit --no-fund @fontsource/inter@5 @fontsource/cormorant-garamond@5 gsap@3", {
    cwd: deps, stdio: "inherit", shell: true,
  });
}

const nm = (...x) => path.join(deps, "node_modules", ...x);
const copies = [[nm("gsap/dist/gsap.min.js"), "assets/vendor/gsap.min.js"]];
// latin covers Western European (incl. German), latin-ext covers Turkish (ş ğ İ), Polish, etc.
for (const subset of ["latin", "latin-ext"]) {
  for (const w of [500, 700, 800]) copies.push([nm(`@fontsource/inter/files/inter-${subset}-${w}-normal.woff2`), `assets/fonts/inter-${subset}-${w}-normal.woff2`]);
  for (const w of [400, 700]) copies.push([nm(`@fontsource/cormorant-garamond/files/cormorant-garamond-${subset}-${w}-normal.woff2`), `assets/fonts/cormorant-garamond-${subset}-${w}-normal.woff2`]);
}
for (const [from, to] of copies) {
  if (!fs.existsSync(from)) throw new Error(`missing ${from}`);
  fs.copyFileSync(from, p(to));
}
// Default sound effects (synthesised, licence-free) — used only when project.json turns "sfx" on.
execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "sfx.mjs"), "--project", root], { stdio: ["ignore", "ignore", "inherit"] });
if (!fs.existsSync(p("edit/project.json"))) console.log("next: copy templates/project.example.json to edit/project.json after transcription");
console.log(`project ready at ${root} (${copies.length} assets)`);
