import { requireAccess } from "@/lib/auth/rbac";
import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAccess(request, "user_admin");
    return json((await getDb().query("SELECT * FROM security_audit ORDER BY id DESC LIMIT 100")).rows);
  } catch (error) { return errorResponse(error); }
}
