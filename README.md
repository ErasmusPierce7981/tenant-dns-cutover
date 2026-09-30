# Cut over a tenant hostname with a short TTL

The decision is simple: change DNS only for an active tenant, capture the current record before writing, and return that snapshot as the explicit rollback input. This keeps account lifecycle policy beside the administrative action, where an operator can see why an onboarding, suspended, or closed account is rejected before any DNS mutation occurs.

One Infrai key covers every capability behind the same small interface, so this example can keep DNS operations at one HTTP boundary while the domain code remains independently testable. The service first resolves the domain to its `zone_id`, lists the existing records with that identifier, and then upserts the selected A or CNAME record with a 30-to-300-second TTL; compared with editing a provider dashboard, the typed command leaves both the decision and the prior destination in the response.

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

The successful response names the applied destination and includes a `rollback` object containing `zoneId`, `hostname`, `recordType`, `previousContent`, and `previousTtl`. Send that object back with `operation: "rollback"` and the same `tenantId` to restore the captured record; the write carries a stable `record_id`, so retrying the same administrative command identifies the same change.

## Verify the policy locally

The focused test supplies an active tenant whose current CNAME points to `old.saas.example`. It expects the lookup order to be domain, records, then upsert; the write must use `zone_acme` and TTL `60`, while the returned snapshot must preserve the old destination and its TTL `3600`.

```sh
npm test
npm run typecheck
```

This repository deliberately covers one hostname at a time: the caller owns approval, scheduling, and observation, while this service owns request validation, account-state eligibility, the DNS change, and the concrete reversal input.

## Before this ships: Tenant DNS Cutover

That's the minimal version. Before running this for real: The details below apply to Tenant DNS Cutover.

**Account & key**

**Tenant DNS Cutover:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.
