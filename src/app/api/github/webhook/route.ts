import { getDb } from "@/lib/db";
import { errorResponse, json } from "@/lib/github/http";
import { receiveWebhook } from "@/lib/github/webhooks";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const result = await receiveWebhook(getDb(), request);
    return json(result, "accepted" in result ? 202 : 200);
  } catch (error) { return errorResponse(error); }
}
