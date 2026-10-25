import pino from "pino";

export const loggerOptions: pino.LoggerOptions = {
  name: process.env.ORBIT_SERVICE_NAME ?? "orbit",
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "orbit" },
  redact: {
    paths: ["authorization", "cookie", "password", "token", "access_token", "client_secret", "secret", "privateKey", "payload", "headers.authorization", "headers.cookie", "req.headers.authorization", "req.headers.cookie"],
    remove: true,
  },
  // Database/upstream error text can contain SQL parameters, URLs or credentials.
  // Keep a safe category/code and correlate via the event's job/request ID.
  serializers: { err: error => ({
    type: error instanceof Error ? error.name : "Error",
    code: typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : undefined,
  }) },
};
export const logger = pino(loggerOptions);
