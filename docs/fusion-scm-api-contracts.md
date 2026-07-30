# Fusion SCM API Contract Audit

This matrix records the Oracle Fusion REST contract used by every node in
`fusion-scm-nodes`. It was audited against the current Oracle Fusion Cloud SCM
REST documentation for release 26B.

Fusion configuration can make additional payload attributes conditionally
required. The fields below are the stable resource keys and request structures
that the nodes can validate or provide without assuming a particular tenant's
item, organization, work definition, transaction, or maintenance setup.

| Node | HTTP contract | Configuration or input contract | Audit result |
|------|---------------|---------------------------------|--------------|
| `scm-server` | OAuth client-credentials token request; builds `/fscmRestApi/resources/{version}` and `/api/scm-core/operational-data/v1` roots | HTTPS token URL, Fusion hostname, API version, scope, and credentials | Matches |
| `fusion-request` | Configured GET/POST/PUT/PATCH/DELETE request | GET mappings become top-level query parameters. Body methods send mapped JSON. Supports ADF Resource Item, POST-only ADF Action, JSON, and POST-only ADF Batch. Custom endpoints must remain in the exact configured SCM API-version hierarchy. Batch targets the version root, normalizes slashless standard operation paths to a leading slash without changing `invoke` paths, permits parameterless `invoke` parts, and requires object payloads for create, update, and replace. | Corrected and guarded |
| `scm-lookup` | GET on the selected collection or manufacturing child collection | Each preset exposes its documented business key and required parent resource IDs. Meter Reading uses the `MetersByAssetMeterUserKey` finder with Asset Number and Meter Code. Custom mode accepts a parameterless request or ordered top-level parameters from a normalized complete URL. Additional Filter names are validated before request construction. | Corrected |
| `smo-transformer` | No HTTP request | Produces `{ entityCode, eventTypeCode, eventTime, data }`; event type and entity code are required, and event time must be supplied or explicitly defaulted | Matches |
| `smo-event` | POST `/api/scm-core/operational-data/v1/events` with JSON | Accepts the Smart Operations event envelope from `msg.smoEvent`, `msg.payload`, or explicit runtime fields | Matches |
| `create-asset` | POST `installedBaseAssets` with ADF Resource Item JSON | Preset exposes Asset Number, Item Number, Operating Organization Code, location context, quantity, and maintenance/work-order flags. Tenant setup determines additional conditional fields. | Matches |
| `create-meter-reading` | POST `meterReadings` with ADF Resource Item JSON | Preset exposes Asset Number, Meter Code, Reading Date, Meter Usage Code, Reading Value, and Comments | Matches |
| `delete-transaction` | DELETE `{collection}/{resourceId}` | Selects `installedBaseAssets`, `meterReadings`, or `inventoryStagedTransactions`, or accepts a same-host custom collection URL; Resource ID is required | Matches |
| `get-ib-asset` | GET `installedBaseAssets?q=SerialNumber=...` | Serial Number is required; use `scm-lookup` when Item Number is also needed for deterministic identification | Matches collection filter |
| `get-meter-reading` | GET `meterReadings?finder=MetersByAssetMeterUserKey;MntAssetNumber=...,MntMeterCode=...` | Asset Number and Meter Code are both required; follows all pages and returns the complete matching collection | Corrected |
| `get-organization-id` | GET `inventoryOrganizations?q=OrganizationName=...` | Organization Name is required; use `scm-lookup` to query by code or ID | Matches |
| `misc-transaction` | POST `inventoryStagedTransactions` with ADF Resource Item JSON | Presets expose source/header/line keys, transaction mode and type, organization, item, quantity, UOM, date, subinventory, and serials. Account Alias modes also expose alias and reason. | Matches |
| `subinventory-quantity-transfer` | POST `inventoryStagedTransactions` with ADF Resource Item JSON | Preset exposes staged-transaction source keys, organization, item, quantity, UOM, date, source/destination subinventory, and serials | Matches |
| `manufacturing-work-order` | POST `workOrders`; PATCH `workOrders/{WorkOrderId}` | Create preset exposes organization, item, work definition code, status/type, planned quantity/dates, explosion flag, and description. Update requires the Fusion Work Order ID. | Matches |
| `manufacturing-work-order-child` | CRUD under `workOrders/{WorkOrderId}/child/...`; POST `operationTransactions` for progress | Parent Work Order ID is required; nested material/resource operations also require Operation ID; item actions require Child ID; create/update actions require mapped payloads | Matches |
| `manufacturing-production-transaction` | POST `operationTransactions` or `materialTransactions` | Operation modes wrap rows in `OperationTransactionDetail`; material/output modes wrap rows in `MaterialTransactionDetail`; mode supplies documented state or transaction-type defaults | Matches |
| `maintenance-work-order` | POST `maintenanceWorkOrders`; PATCH `maintenanceWorkOrders/{WorkOrderId}` | Create preset exposes organization, asset, maintenance work definition code, type/subtype/status, planned quantity/date, flags, and description. Update requires the Fusion Work Order ID. | Matches |
| `maintenance-work-order-child` | CRUD under `maintenanceWorkOrders/{WorkOrderId}/child/...`; POST `maintenanceOperationTransactions` for cost transactions | Parent Work Order ID is required; nested material/resource operations also require Operation ID; item actions require Child ID; create/update actions require mapped payloads | Matches |

## Lookup query rules

- Fusion `q` is a top-level collection query parameter whose value is a field
  expression such as `AssetNumber=ASSET-100`.
- Fusion `finder` is a separate top-level parameter whose value is the complete
  finder expression.
- The Meter Readings collection still documents `AssetNumber` and `MeterCode`
  as queryable `q` fields. It also documents the composite
  `MetersByAssetMeterUserKey` finder. The dedicated meter nodes use the finder
  because it expresses the intended asset-meter business key and behaves
  consistently across environments.
- Additional Filters remain a separate `q` expression for predefined lookups.
  Filter field names are limited to Oracle attribute-style names containing
  letters, numbers, underscores, and dots.
- Custom lookup parameters are ordered name/value entries. All top-level
  parameter types use the same opaque-value mechanism, including `q`, `finder`,
  `fields`, `limit`, and `offset`; repeated names and empty values are
  preserved. A parameterless Custom GET is also valid.
- Custom lookup URLs are restricted to HTTPS resources at or below the
  configured Fusion origin and API-version root. Credentials, fragments,
  cross-origin paths, different API versions, and redirects are rejected before
  the configured bearer token can leave that boundary.
- Multi-page Meter Reading results are normalized into one collection.
  `items` and `count` cover the complete history, `hasMore` is `false`,
  `offset` is `0`, `limit` retains Fusion's page size, and page-specific
  `links` are omitted.

## Verification boundary

This audit verifies node routes, methods, media types, query structure, parent
resource IDs, payload wrappers, and editor presets. Fusion may still reject a
request when tenant-specific setup is absent or inconsistent, such as an item
not assigned to an organization, an invalid transaction type, an inactive work
definition, or a missing work center/resource relationship.

## Oracle references

- [Oracle Fusion Cloud SCM 26B REST endpoints](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fasrp/rest-endpoints.html)
- [Get all meter readings](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fasrp/op-meterreadings-get.html)
- [Create one meter reading](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26b/fasrp/op-meterreadings-post.html)
