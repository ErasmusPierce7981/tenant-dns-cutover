import assert from "node:assert/strict";
import test from "node:test";
import { applyTenantCutover } from "../src/cutover_policy.ts";

test("an active tenant gets a short-TTL cutover and an exact rollback snapshot", async () => {
  const calls: Array<{ name: string; value: unknown }> = [];
  const client = {
    async getZone(domain: string) {
      calls.push({ name: "getZone", value: domain });
      return { zone_id: "zone_acme" };
    },
    async listRecords(zoneId: string) {
      calls.push({ name: "listRecords", value: zoneId });
      return {
        records: [{
          record_id: "record_old",
          record_type: "CNAME",
          name: "app.acme.example",
          content: "old.saas.example",
          ttl: 3600,
        }],
      };
    },
    async upsertRecord(input: unknown) {
      calls.push({ name: "upsertRecord", value: input });
      return input as never;
    },
  };

  const result = await applyTenantCutover(client, {
    tenantId: "tenant_acme",
    accountStatus: "active",
    domain: "acme.example",
    hostname: "app.acme.example",
    recordType: "CNAME",
    destination: "edge.saas.example",
    ttl: 60,
  });

  assert.deepEqual(calls.map((call) => call.name), ["getZone", "listRecords", "upsertRecord"]);
  assert.equal((calls[2]?.value as { zone_id: string }).zone_id, "zone_acme");
  assert.equal((calls[2]?.value as { ttl: number }).ttl, 60);
  assert.equal(result.decision, "cutover_applied");
  assert.deepEqual(result.rollback, {
    zoneId: "zone_acme",
    hostname: "app.acme.example",
    recordType: "CNAME",
    previousContent: "old.saas.example",
    previousTtl: 3600,
  });
});
