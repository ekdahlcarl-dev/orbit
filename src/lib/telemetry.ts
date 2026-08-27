import { trace } from "@opentelemetry/api";

const serviceName = process.env.ORBIT_SERVICE_NAME ?? "orbit";

export const tracer = trace.getTracer(serviceName);

export function telemetrySummary() {
  return {
    service: serviceName,
    api: "opentelemetry",
    exporterConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT),
  };
}
