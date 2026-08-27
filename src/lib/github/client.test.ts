import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GitHubClient } from "./client";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = { GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), GITHUB_ALLOWED_INSTALLATION_IDS: "10" };
const repo = { id: 5, name: "repo", full_name: "org/repo", archived: false, default_branch: "main" };
function mockTransport(respond: (url: URL, init?: RequestInit) => unknown): typeof fetch {
  return async (url, init) => {
    const result = respond(new URL(String(url)), init);
    return result instanceof Response ? result : Response.json(result);
  };
}

test("repository membership is checked even when GitHub could read a public repo", async () => {
  const paths: string[] = [];
  const github = new GitHubClient(mockTransport((url, init) => {
    paths.push(url.pathname);
    if (url.pathname.endsWith("access_tokens")) {
      assert.deepEqual(JSON.parse(String(init?.body)).permissions, { contents: "read", actions: "read", metadata: "read" });
      return { token: "ephemeral" };
    }
    return { repositories: [repo] };
  }), env);
  await assert.rejects(() => github.options(10, 999), /not authorized/);
  assert.equal(paths.some(path => path.startsWith("/repos/")), false);
  await assert.rejects(() => github.repositories(20), /not authorized/);
  assert.equal(paths.length, 2);
});

test("pagination returns repositories beyond first 100 and does not expose credentials", async () => {
  const github = new GitHubClient(mockTransport(url => {
    if (url.pathname.endsWith("access_tokens")) return { token: "secret-token" };
    return { repositories: url.searchParams.get("page") === "1" ? Array.from({ length: 100 }, (_, id) => ({ ...repo, id: id + 1 })) : [{ ...repo, id: 101 }] };
  }), env);
  const repositories = await github.repositories(10);
  assert.equal(repositories.length, 101);
  assert.equal(JSON.stringify(repositories).includes("secret-token"), false);
});

test("installation discovery excludes unapproved and suspended installations", async () => {
  const github = new GitHubClient(mockTransport(() => [{ id: 10, account: { login: "org" }, suspended_at: null }, { id: 20, account: { login: "other" }, suspended_at: null }]), env);
  assert.deepEqual((await github.installations()).map(i => i.id), [10]);
});

test("validation verifies exact ref and workflow file; errors never leak upstream body", async () => {
  const requests: URL[] = [];
  const github = new GitHubClient(mockTransport(url => {
    requests.push(url);
    if (url.pathname.endsWith("access_tokens")) return { token: "secret-token" };
    if (url.pathname === "/installation/repositories") return { repositories: [repo] };
    if (url.pathname.includes("/git/ref/")) return { object: { sha: "abc" } };
    if (url.pathname.includes("/actions/workflows/")) return { id: 7, state: "active", path: ".github/workflows/build.yml" };
    return { type: "file" };
  }), env);
  await github.validate(10, 5, "heads/feature/test", 7);
  assert.equal(requests.at(-1)?.searchParams.get("ref"), "refs/heads/feature/test");
  await assert.rejects(() => github.validate(10, 5, "../main", 7), /Choose a branch/);
  const bad = new GitHubClient(mockTransport(() => new Response("secret upstream data", { status: 500 })), env);
  await assert.rejects(() => bad.repositories(10), error => error instanceof Error && !error.message.includes("secret upstream data"));
});
