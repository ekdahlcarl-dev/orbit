import assert from "node:assert/strict";
import test from "node:test";
import pino from "pino";
import { loggerOptions } from "./logger";

test("logs retain diagnostic IDs without bearer values or upstream error details", () => {
  let output = "";
  const logger = pino(loggerOptions, { write(chunk: string) { output += chunk; } });
  logger.error({ jobId: 42, token: "sensitive-bearer", headers: { authorization: "Bearer sensitive-auth" }, payload: { secret: "sensitive-payload" }, err: new Error("postgres://user:sensitive-password@db") }, "worker failed");
  assert.equal(JSON.parse(output).jobId, 42);
  assert.ok(!output.includes("sensitive-"));
});
