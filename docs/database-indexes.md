# Database Index Checklist

These indexes match the current cloud-function query paths. Create them in the WeChat Cloud Database console before production use.

## projects

- `deleted`, `updatedAt desc`
- `createdBy`, `deleted`, `updatedAt desc`
- `ownerOpenid`, `deleted`, `updatedAt desc`
- `pmOpenid`, `deleted`, `updatedAt desc`
- `memberOpenids`, `deleted`, `updatedAt desc`
- `employeeBudgets.memberOpenid`, `deleted`, `updatedAt desc`
- `precalId`, `deleted`
- `sapNumbers`, `deleted`
- `createdBy`, `clientRequestId`, `deleted`

## precal_records

- `deleted`, `updatedAt desc`
- `createdBy`, `deleted`, `updatedAt desc`
- `status`, `deleted`, `submittedAt desc`
- `status`, `deleted`, `updatedAt desc`
- `sapBindings.sapOrderNo`, `deleted`
- `sapNumbers`, `deleted`
- `createdProjectId`, `deleted`
- `createdBy`, `clientRequestId`, `deleted`

`sapBindings.sapOrderNo, deleted` is required by the global active SAP binding conflict check before saving SAP bindings.

## ar_summaries

- `summaryKey`
- `active`, `sapOrderNo`
- `sapOrderNo`, `itemNo`, `employeeName`
- `importBatchId`
- `active`, `updatedAt desc`

## users

- `openid`
- `_openid`
- `deleted`, `updatedAt desc`
- `roles`

## ar_import_logs

- `importBatchId`
- `importedAt desc`
- `status`, `importedAt desc`
