import type { ServiceHealth, ServiceName } from "@raise/shared-types";

export function getServiceHealth(service: ServiceName): ServiceHealth {
  return { service, status: "ok" };
}
