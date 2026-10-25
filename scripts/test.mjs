// Load TS tests through tsx's CJS hook. Explicit loading also avoids runtimes
// reporting a successful file subprocess without registering its test cases.
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
function loadTests(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) loadTests(filename);
    else if (entry.name.endsWith(".test.ts")) require(filename);
  }
}
loadTests(resolve("src"));
