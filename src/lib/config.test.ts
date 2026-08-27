import assert from "node:assert/strict";
import test from "node:test";
import { parseServerConfig } from "./config";

test("server config validates required database URL and applies safe defaults", () => {
  const config = parseServerConfig({ DATABASE_URL: "postgres://orbit:orbit@localhost:5433/orbit" });
  assert.equal(config.ORBIT_ENV, "development");
  assert.equal(config.OBJECT_STORAGE_DRIVER, "local");
  assert.equal(config.ORBIT_SERVICE_NAME, "orbit");
});

test("server config rejects missing secrets/configuration", () => {
  assert.throws(() => parseServerConfig({}), /DATABASE_URL/);
});
