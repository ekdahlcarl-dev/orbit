import { z } from "zod";

const serverSchema = z.object({
  ORBIT_ENV: z.enum(["development", "test", "production"]).default("development"),
  ORBIT_SERVICE_NAME: z.string().min(1).default("orbit"),
  DATABASE_URL: z.string().url(),
  OBJECT_STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  OBJECT_STORAGE_LOCAL_DIR: z.string().default(".orbit-storage"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type ServerConfig = z.infer<typeof serverSchema>;
export type EnvironmentInput = Record<string, string | undefined>;

export function parseServerConfig(env: EnvironmentInput): ServerConfig {
  return serverSchema.parse(env);
}

export function getServerConfig(): ServerConfig {
  return parseServerConfig(process.env);
}
