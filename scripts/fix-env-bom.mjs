import { readFileSync, writeFileSync, statSync } from "node:fs";

const path = ".env";
let buf = readFileSync(path);
if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
  buf = buf.subarray(3);
}
let text = buf.toString("utf8").replace(/^\uFEFF/, "");
// Repair mojibake from earlier UTF-8 mis-decoding in comments only.
text = text
  .replaceAll("â€”", "-")
  .replaceAll("â†’", "->")
  .replaceAll("Â", "");
if (!text.endsWith("\n")) text += "\n";
writeFileSync(path, text, { encoding: "utf8" });
console.log("rewrote .env without BOM, bytes=", statSync(path).size);
