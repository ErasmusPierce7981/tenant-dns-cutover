import { createHash } from "node:crypto";
import type { DnsRecord, InfraiDnsClient } from "./infrai_dns.ts";

export type AccountStatus = "onboarding" | "active" | "suspended" | "closed";

export type CutoverCommand = {
  tenantId: string;
  accountStatus: AccountStatus;
  domain: string;
  hostname: string;
  recordType: "A" | "CNAME";
  destination: string;
  ttl: number;
};

export type RollbackSnapshot = {
  zoneId: string;
  hostname: string;
  recordType: "A" | "CNAME";
  previousContent: string;
  previousTtl: number;
};

export type CutoverResult = {
  tenantId: string;
  decision: "cutover_applied";
  zoneId: string;
  hostname: string;
  destination: string;
  ttl: number;
  rollback: RollbackSnapshot;
};

export class AccountNotActiveError extends Error {}
export class PreviousRecordNotFoundError extends Error {}

function stableRecordId(command: CutoverCommand): string {
  return createHash("sha256")
    .update(`${command.tenantId}:${command.hostname}:${command.recordType}`)
    .digest("hex")
    .slice(0, 32);
}

export async function applyTenantCutover(
  client: Pick<InfraiDnsClient, "getZone" | "listRecords" | "upsertRecord">,
  command: CutoverCommand,
): Promise<CutoverResult> {
  if (command.accountStatus !== "active") {
    throw new AccountNotActiveError("Only an active tenant account can change its hostname");
  }

  const { zone_id } = await client.getZone(command.domain);
  const { records } = await client.listRecords(zone_id);
  const previous = records.find(
    (record) => record.name === command.hostname && record.record_type === command.recordType,
  );
  if (!previous) {
    throw new PreviousRecordNotFoundError("The current hostname record is required for rollback");
  }

  await client.upsertRecord({
    zone_id,
    record_type: command.recordType,
    name: command.hostname,
    content: command.destination,
    ttl: command.ttl,
    record_id: stableRecordId(command),
  });

  return {
    tenantId: command.tenantId,
    decision: "cutover_applied",
    zoneId: zone_id,
    hostname: command.hostname,
    destination: command.destination,
    ttl: command.ttl,
    rollback: {
      zoneId: zone_id,
      hostname: command.hostname,
      recordType: command.recordType,
      previousContent: previous.content,
      previousTtl: previous.ttl ?? command.ttl,
    },
  };
}

export async function restoreTenantHostname(
  client: Pick<InfraiDnsClient, "upsertRecord">,
  tenantId: string,
  snapshot: RollbackSnapshot,
): Promise<{ decision: "rollback_applied"; hostname: string; content: string }> {
  const record_id = createHash("sha256")
    .update(`${tenantId}:${snapshot.hostname}:${snapshot.recordType}`)
    .digest("hex")
    .slice(0, 32);
  await client.upsertRecord({
    zone_id: snapshot.zoneId,
    record_type: snapshot.recordType,
    name: snapshot.hostname,
    content: snapshot.previousContent,
    ttl: snapshot.previousTtl,
    record_id,
  });
  return {
    decision: "rollback_applied",
    hostname: snapshot.hostname,
    content: snapshot.previousContent,
  };
}
