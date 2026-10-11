# Native tool contracts v1

Design bounds (recorded before adapter wiring):

| Family | Admitted facts and exact references | Numeric output bounds | Outcome |
| --- | --- | --- | --- |
| Session analyze/query | schema-2 report counters, vetted labels, opaque refs (26 characters), selector-bound cursors (48); opt-in locator path (4096), never clipped | Native envelope 32768 UTF-8 bytes; direct content 8192 bytes; retained report details 32768 bytes; 10 page rows, 8 field shapes, 2 ancestry records | Inspection is successful with incomplete coverage; invalid/stale/expired/scope/cursor failures are errors; release changes memory state |
| Eval review | rule/severity, relative finding path (4096), safe rule message (256), case counts | Native envelope 32768 bytes, up to 100 findings with total/returned/omitted; direct content 8192 bytes, at most 50 findings | Completed review with findings is successful; inability to review is failure |
| Eval bootstrap | planned relative file refs (4096), eval name (64), intended script (160), case counts, observed stage effects | Native envelope 32768 bytes, up to 46 planned files; direct content 8192 bytes | Preview has no writes; denied/no UI is not-dispatched; apply stage/rollback and projection failures preserve uncertainty, never replay |

Page size/index/expiry/privacy limits are domain/resource limits, unchanged: four reports, 5000 events, conservative 4 MiB serialized index, 256 nested records/result, 15 minutes. The former 8192-byte *combined wrapper* presentation limit is superseded by independent channel budgets. Page selection charges the actual native envelope, not duplicated representations. Direct JSON can show fewer rows than the native page, explicitly reporting presentation omissions; details retains the existing bounded schema-2 report for consumers. No private index or DTO is persisted in details as a transcript repair.

Tool envelopes use `contractVersion:1`, literal `operation`, and `ok`; report `schemaVersion:2` is a separate domain version. Consumers must distinguish source/capture/index completeness from findings and operation success. Exact admitted identities are validated, not shortened. Review messages that interpolate config/parse/case values are replaced with a rule-specific safe description; arbitrary config and prompts are not published. Whole-byte overflow produces a contract error.

Codemode receives the native envelope directly. For example:

```js
const result = await tools.pi_query_session({reportRef: load("reportRef"), limit: 10});
if (!result.ok) text(result.error);
else if (result.report.view === "events") text(result.report.rows.map(row => ({eventRef: row.eventRef, kind: row.kind})));
```

Small whole results may also be printed. Non-codemode `ctx.executeTool` returns an outcome wrapper, not this DTO. Data failures retain native `isError:true` and can resolve `ok:false`; host argument validation, hooks, throws or aborts without DTOs can reject. Foreign hooks may alter/drop data after producer validation. Execution-event DTOs are not ordinary persisted tool-result messages. Do not restore redacted/absent data, rescan invalid reports, or replay uncertain scaffolding.

Apply still requires explicit intent, preview, interactive/RPC confirmation, the mutation queue and existing lock. Generated eval runners/extensions are host code, not sandboxed, and are not executed by review/bootstrap.

Eval adapters now retain only the bounded public projection in `details` (not absolute package roots or raw config-bearing messages). Exported producer review/bootstrap result interfaces remain intact; bootstrap adds optional stage observations. `changedReferences` records completed write/publication targets even when subsequently rolled back; failed/started stages can have additional possible effects. `referencesOmitted` discloses withheld unsafe/oversized receipt references. A completed rollback does not verify unrelated concurrent state or source correctness.
