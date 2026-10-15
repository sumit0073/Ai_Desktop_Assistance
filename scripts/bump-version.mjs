/**
 * Sync app version across package.json, Tauri config, and Cargo.toml.
 * Usage: node scripts/bump-version.mjs 0.1.7
 */
import { readFileSync, writeFileSync } from "node:fs";

const raw = (process.argv[2] || "").trim().replace(/^v/i, "");
if (!/^\d+\.\d+\.\d+$/.test(raw)) {
  console.error("Usage: node scripts/bump-version.mjs <semver>  (e.g. 0.1.7)");
  process.exit(1);
}

function writeJson(path, mutator) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  mutator(data);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

writeJson("package.json", (pkg) => {
  pkg.version = raw;
});

writeJson("package-lock.json", (lock) => {
  lock.version = raw;
  if (lock.packages?.[""]) lock.packages[""].version = raw;
});

writeJson("src-tauri/tauri.conf.json", (conf) => {
  conf.version = raw;
});

const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${raw}"`,
);
writeFileSync(cargoPath, cargo);

const lockPath = "src-tauri/Cargo.lock";
const cargoLock = readFileSync(lockPath, "utf8");
const patched = cargoLock.replace(
  /(name = "ai-desktop-assistant"\n)version = "[^"]+"/,
  `$1version = "${raw}"`,
);
writeFileSync(lockPath, patched);

console.log(JSON.stringify({ ok: true, version: raw }));
