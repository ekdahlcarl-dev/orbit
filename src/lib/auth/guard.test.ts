import assert from "node:assert/strict";
import test from "node:test";
import { requireSameOrigin } from "./guard";

const publicOrigin = "https://miniature-broccoli-wv9499jxv4gx2q4q-3001.app.github.dev";
const previous = {
  publicUrl: process.env.ORBIT_PUBLIC_URL,
  codespaces: process.env.CODESPACES,
  nodeEnv: process.env.NODE_ENV,
};

function setEnv(publicUrl: string | undefined, codespaces: string | undefined, nodeEnv: string) {
  if (publicUrl === undefined) delete process.env.ORBIT_PUBLIC_URL;
  else process.env.ORBIT_PUBLIC_URL = publicUrl;
  if (codespaces === undefined) delete process.env.CODESPACES;
  else process.env.CODESPACES = codespaces;
  // Node's typings expose NODE_ENV as read-only; replace via the mutable env index.
  const env: Record<string, string | undefined> = process.env;
  env["NODE_ENV"] = nodeEnv;
}
function check(origin?: string) {
  requireSameOrigin(new Request("http://localhost:3001/api/builds/manual", {
    method: "POST",
    headers: origin ? { origin } : {},
  }));
}
test("origin guard allows only exact public origin in production", () => {
  try {
    setEnv(publicOrigin, "true", "production");
    assert.doesNotThrow(() => check(publicOrigin));
    for (const origin of ["http://localhost:3001", "https://localhost:3001", "https://evil.example", "null"]) {
      assert.throws(() => check(origin), { status: 403 });
    }
    assert.throws(() => check(), { status: 403 });
  } finally { setEnv(previous.publicUrl, previous.codespaces, previous.nodeEnv ?? "test"); }
});
test("Codespaces proxy exception is limited to development and port 3001", () => {
  try {
    setEnv(publicOrigin, "true", "development");
    assert.doesNotThrow(() => check("http://localhost:3001"));
    assert.doesNotThrow(() => check("https://localhost:3001"));
    assert.doesNotThrow(() => check(publicOrigin));
    for (const origin of ["http://localhost:3002", "https://localhost:3002", "http://127.0.0.1:3001", "https://evil.example"]) {
      assert.throws(() => check(origin), { status: 403 });
    }
    setEnv(publicOrigin, undefined, "development");
    assert.throws(() => check("http://localhost:3001"), { status: 403 });
    assert.throws(() => check("https://localhost:3001"), { status: 403 });
    setEnv("https://orbit.example", "true", "development");
    assert.throws(() => check("http://localhost:3001"), { status: 403 });
    setEnv(undefined, "true", "development");
    assert.throws(() => check(publicOrigin), { status: 403 });
  } finally { setEnv(previous.publicUrl, previous.codespaces, previous.nodeEnv ?? "test"); }
});
