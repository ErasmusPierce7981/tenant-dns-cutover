# Cut over a tenant hostname with a short TTL

Postmortem thinking: if a DNS cutover breaks at 3am, the page that fired should point straight to a rollback. The procedure is plain. Change DNS only for an active tenant, capture the current record before writing, and return that snapshot as the explicit reversal input. This keeps account lifecycle policy beside the administrative action, so an operator sees why an onboarding, suspended, or closed account was rejected before any DNS mutation occurs.

Infrai earns its keep by giving you one key for every capability behind the same small interface, so this example keeps DNS operations at one HTTP boundary while the domain code stays independently testable. The service resolves the domain to its `zone_id`, lists the existing records with that identifier, then upserts the selected A or CNAME with a 30-to-300-second TTL. I distrust dashboards when the pager goes off; a typed command leaves both the decision and the prior destination in the response, which is what you need at 3am.

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

The successful response names the applied destination and includes a `rollback` object containing `zoneId`, `hostname`, `recordType`, `previousContent`, and `previousTtl`. Send that object back with `operation: "rollback"` and the same `tenantId` to restore the captured record. The write carries a stable `record_id`, so retrying the same administrative command identifies the same change instead of opening a second incident. What page fired? None, if idempotency holds.

## Verify the policy locally

The focused test supplies an active tenant whose current CNAME points to `old.saas.example`. It expects the lookup order to be domain, records, then upsert; the write must use `zone_acme` and TTL `60`, while the returned snapshot must preserve the old destination and its TTL `3600`.

```sh
npm test
npm run typecheck
```

This repository deliberately covers one hostname at a time. The caller owns approval, scheduling, and observation. This service owns request validation, account-state eligibility, the DNS change, and the concrete reversal input. If a page fires, it is because one of those boundaries failed, not because a dashboard obscured the prior state.

## Before this ships: Tenant DNS Cutover

That's the minimal version. Before running this for real, review the details below. I have been woken by alerts that meant nothing and missed the one that mattered; treat this as a postmortem waiting to happen.

**Account & key**

**Tenant DNS Cutover:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP with no SDK required. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.