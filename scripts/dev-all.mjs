#!/usr/bin/env node
// Start ORBIT's local dependencies, web server, and background worker together.
// Run with: npm run dev:all
import { spawn } from "node:child_process";

const port = process.env.ORBIT_DEV_PORT ?? "3001";
const children = new Set();
let stopping = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env, ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`))
    );
  });
}

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

async function main() {
  // The .env.local file is loaded by Node via the npm script's --env-file flag.
  await run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
  if (stopping) return;
  await run("npm", ["run", "db:migrate"]);
  if (stopping) return;

  const processes = [
    ["web", "npm", ["run", "dev", "--", "-p", port, "-H", "0.0.0.0"]],
    ["worker", "npm", ["run", "worker"]],
  ];

  for (const [name, command, args] of processes) {
    const child = spawn(command, args, { stdio: "inherit", env: process.env, detached: true });
    children.add(child);
    child.on("error", (error) => {
      console.error(`[dev:all] ${name} failed to start:`, error);
      stop();
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (!stopping) {
        console.error(`[dev:all] ${name} exited (${signal ?? code}); stopping other processes`);
        process.exitCode = code || 1;
        stop();
      }
    });
  }
  console.log(`[dev:all] ORBIT web on port ${port}; worker started`);
}

main().catch((error) => {
  console.error("[dev:all] startup failed:", error);
  process.exitCode = 1;
  stop();
});
