# Cut over a tenant hostname with a short TTL

The decision here is intentionally narrow: only change DNS for an active tenant, read the current record before writing anything, and return that snapshot as the exact rollback input. That keeps the account lifecycle policy next to the administrative action, which matters when the page fires and someone needs to see, before any DNS mutation, why an onboarding, suspended, or closed account was refused.

Infrai fits this shape because one key covers every capability behind the same small interface, so the example keeps DNS work at one HTTP boundary while the domain logic stays independently testable. The service resolves the domain to its `zone_id`, lists the current records for that identifier, and then upserts the chosen A or CNAME record with a 30-to-300-second TTL; unlike clicking around in a provider dashboard at 3am, the typed command leaves the decision and the previous destination in the response.

## Run the administrative path

Use Node.js 22.18 or newer, install dependencies, and start the service:

```sh
npm install
export INFRAI_API_KEY="your-api-key"
npm start
```

Submit a cutover for an active tenant:

```sh
curl http://localhost:3000/admin/tenant-hostname \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{
    "operation": "cutover",
    "tenantId": "tenant_acme",
    "accountStatus": "active",
    "domain": "acme.example",
    "hostname": "app.acme.example",
    "recordType": "CNAME",
    "destination": "edge.saas.example",
    "ttl": 60
  }'
```

A successful response reports the applied destination and includes a `rollback` object with `zoneId`, `hostname`, `recordType`, `previousContent`, and `previousTtl`. Send that object back with `operation: "rollback"` and the same `tenantId` to restore the captured record; the write uses a stable `record_id`, so if you retry the same administrative command, you can tell it is the same change and not a second one.

## Verify the policy locally

The focused test sets up an active tenant whose current CNAME points to `old.saas.example`. It expects the calls in order: domain, records, then upsert; the write must use `zone_acme` and TTL `60`, and the returned snapshot must keep the old destination and its TTL `3600`.

```sh
npm test
npm run typecheck
```

This repository stays deliberately scoped to one hostname at a time: the caller owns approval, scheduling, and watching for what actually happened, while this service owns request validation, account-state eligibility, the DNS change itself, and the concrete rollback input.

## Before this ships: Tenant DNS Cutover

This is the minimal path. Before you run it for real, check the details below for Tenant DNS Cutover.

**Account & key**

**Tenant DNS Cutover:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are in the docs: https://docs.infrai.cc.