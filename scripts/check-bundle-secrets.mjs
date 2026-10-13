/**
 * Fail if a production Vite bundle appears to contain a Groq secret.
 * Does not print secret values — only match presence.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "dist");
const patterns = [
  /\bgsk_[A-Za-z0-9]{10,}\b/,
  /VITE_GROQ_API_KEY\s*[:=]\s*["']?(?!your-groq)[A-Za-z0-9_-]{20,}/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|css|html|map)$/i.test(name)) out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(dist);
} catch {
  console.error("dist/ missing — run npm run build first");
  process.exit(2);
}

let hits = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const re of patterns) {
    if (re.test(text)) {
      hits += 1;
      console.error(`[secret-check] FAIL pattern ${re} in ${file}`);
    }
  }
}

if (hits > 0) {
  console.error(
    `[secret-check] ${hits} hit(s). Remove client Groq keys from the build env (use chat-proxy / stt-proxy server secrets). Rotate any exposed key.`,
  );
  process.exit(1);
}

console.log("[secret-check] OK — no Groq secret patterns found in dist/");
