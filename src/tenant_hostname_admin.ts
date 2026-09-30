import { createServer } from "node:http";
import { z } from "zod";
import { InfraiDnsClient, InfraiError } from "./infrai_dns.ts";
import {
  AccountNotActiveError,
  PreviousRecordNotFoundError,
  applyTenantCutover,
  restoreTenantHostname,
} from "./cutover_policy.ts";

const cutoverBody = z.object({
  operation: z.literal("cutover"),
  tenantId: z.string().min(1),
  accountStatus: z.enum(["onboarding", "active", "suspended", "closed"]),
  domain: z.string().min(1),
  hostname: z.string().min(1),
  recordType: z.enum(["A", "CNAME"]),
  destination: z.string().min(1),
  ttl: z.number().int().min(30).max(300),
});

const rollbackBody = z.object({
  operation: z.literal("rollback"),
  tenantId: z.string().min(1),
  snapshot: z.object({
    zoneId: z.string().min(1),
    hostname: z.string().min(1),
    recordType: z.enum(["A", "CNAME"]),
    previousContent: z.string().min(1),
    previousTtl: z.number().int().positive(),
  }),
});

const adminBody = z.discriminatedUnion("operation", [cutoverBody, rollbackBody]);
const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const client = new InfraiDnsClient(apiKey);

function reply(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/admin/tenant-hostname") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = adminBody.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      reply(response, 400, { error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const result = parsed.data.operation === "cutover"
      ? await applyTenantCutover(client, parsed.data)
      : await restoreTenantHostname(client, parsed.data.tenantId, parsed.data.snapshot);
    reply(response, 200, result);
  } catch (error) {
    if (error instanceof InfraiError) {
      reply(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        details: error.details,
      });
      return;
    }
    if (error instanceof AccountNotActiveError || error instanceof PreviousRecordNotFoundError) {
      reply(response, 409, { error: error.message });
      return;
    }
    if (error instanceof SyntaxError) {
      reply(response, 400, { error: "Request body must be valid JSON" });
      return;
    }
    reply(response, 500, { error: "Unexpected service error" });
  }
}).listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`Tenant hostname admin listening on http://localhost:${process.env.PORT ?? 3000}`);
});
