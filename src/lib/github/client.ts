import type { EnvironmentInput } from "../config";
import { allowedInstallations, appJwt, IntegrationError, requireInstallation } from "./security";

export interface Repository { id: number; name: string; full_name: string; default_branch: string; archived: boolean; }
export interface Workflow { id: number; name: string; path: string; state: string; }
export interface Installation { id: number; account: { login: string }; suspended_at: string | null; }

export class GitHubClient {
  constructor(private transport: typeof fetch = fetch, private env: EnvironmentInput = process.env) {}

  private async request<T>(path: string, token: string, body?: object): Promise<T> {
    const response = await this.transport(`https://api.github.com${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      // Never return GitHub response bodies, tokens, or keys to logs/UI.
      const status = [403, 404].includes(response.status) ? response.status : 502;
      throw new IntegrationError(status, response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0"
        ? "GitHub rate limit reached; retry later" : "GitHub request failed; check installation access and permissions");
    }
    return response.json() as Promise<T>;
  }

  private async pages<T>(path: string, token: string, key?: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.request<T[] | Record<string, T[]>>(`${path}?per_page=100&page=${page}`, token);
      const batch = key ? (result as Record<string, T[]>)[key] : result as T[];
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new IntegrationError(502, "GitHub result exceeds supported size; narrow the installation scope");
  }

  async installations(): Promise<Installation[]> {
    const allowed = allowedInstallations(this.env);
    return (await this.pages<Installation>("/app/installations", appJwt(this.env)))
      .filter(item => allowed.includes(item.id) && !item.suspended_at)
      .map(({ id, account, suspended_at }) => ({ id, account: { login: account.login }, suspended_at }));
  }

  private async token(installationId: number) {
    requireInstallation(installationId, this.env);
    const result = await this.request<{ token: string }>(`/app/installations/${installationId}/access_tokens`, appJwt(this.env), {
      permissions: { contents: "read", actions: "read", metadata: "read" },
    });
    return result.token; // Short-lived, request-local only; never persisted.
  }

  async repositories(installationId: number): Promise<Repository[]> {
    const token = await this.token(installationId);
    return (await this.pages<Repository>("/installation/repositories", token, "repositories"))
      .map(({ id, name, full_name, default_branch, archived }) => ({ id, name, full_name, default_branch, archived }));
  }

  async repositoryContext(installationId: number, repositoryId: number) {
    const token = await this.token(installationId);
    // Explicit membership check: installation tokens can also read some public repos.
    const repositories = await this.pages<Repository>("/installation/repositories", token, "repositories");
    const repository = repositories.find(item => item.id === repositoryId);
    if (!repository) throw new IntegrationError(403, "Repository is not authorized for this installation");
    if (repository.archived) throw new IntegrationError(409, "Archived repositories cannot be configured");
    const root = `/repos/${repository.full_name.split("/").map(encodeURIComponent).join("/")}`;
    return { repository, token, root };
  }

  async options(installationId: number, repositoryId: number) {
    const { repository, token, root } = await this.repositoryContext(installationId, repositoryId);
    const [branches, tags, workflows] = await Promise.all([
      this.pages<{ name: string }>(`${root}/branches`, token),
      this.pages<{ name: string }>(`${root}/tags`, token),
      this.pages<Workflow>(`${root}/actions/workflows`, token, "workflows"),
    ]);
    return { defaultRef: `heads/${repository.default_branch}`, refs: [...branches.map(b => `heads/${b.name}`), ...tags.map(t => `tags/${t.name}`)],
      workflows: workflows.filter(w => w.state === "active").map(({ id, name, path, state }) => ({ id, name, path, state })) };
  }

  async validate(installationId: number, repositoryId: number, ref: string, workflowId: number) {
    const { repository, token, root } = await this.repositoryContext(installationId, repositoryId);
    if (!/^(heads|tags)\/.+/.test(ref)) throw new IntegrationError(400, "Choose a branch or tag ref");
    const [gitRef, workflow] = await Promise.all([
      this.request<{ object: { sha: string } }>(`${root}/git/ref/${ref.split("/").map(encodeURIComponent).join("/")}`, token),
      this.request<Workflow>(`${root}/actions/workflows/${workflowId}`, token),
    ]);
    if (workflow.state !== "active" || !workflow.path.startsWith(".github/workflows/")) throw new IntegrationError(400, "Choose an active workflow");
    // Ensure the selected workflow exists on the chosen ref, not only the default branch.
    const file = await this.request<{ type: string }>(`${root}/contents/${workflow.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(`refs/${ref}`)}`, token);
    if (file.type !== "file") throw new IntegrationError(400, "Workflow does not exist on the selected ref");
    return { repository, workflow, refSha: gitRef.object.sha };
  }
}
