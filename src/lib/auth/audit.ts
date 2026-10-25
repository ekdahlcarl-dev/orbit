import type { Pool, PoolClient } from "pg";
import { transaction } from "../github/store";
import type { GithubIdentity } from "./oauth";

/** Bind audit identity and all related writes to the same transaction/client. */
export function withAuditActor<T>(db: Pool, actor: GithubIdentity, work: (client: PoolClient) => Promise<T>) {
  return transaction(db, async client => {
    await client.query("SELECT set_config('orbit.actor', $1, true), set_config('orbit.github_user_id', $2, true)",
      [`github:${actor.id}:${actor.login}`, String(actor.id)]);
    return work(client);
  });
}
