import pino from "pino";

export const logger = pino({
  name: process.env.ORBIT_SERVICE_NAME ?? "orbit",
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "orbit" },
});
