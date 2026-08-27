import { ZodError } from "zod";
import { IntegrationError } from "./security";

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Vary": "Authorization" } });
}

export function errorResponse(error: unknown) {
  if (error instanceof IntegrationError) return json({ error: error.message }, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError) return json({ error: "Invalid request data" }, 400);
  return json({ error: "Integration unavailable; check server configuration and connectivity" }, 503);
}
