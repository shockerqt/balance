# BAL-065 food search performance review

The limits below are proposed for the pre-merge review of the PostgreSQL 17 synthetic rehearsal at `6b4e3af972a30f406158f3e0a457be1765b3f77b`. Operator approval of these limits is pending. Production migration and API promotion require their own approvals. [BAL-065 task and implementation evidence](https://github.com/shockerqt/balance/issues/128#issuecomment-7068614228) · [Database migration runbook](database-migrations.md) · [Delivery runbook](delivery.md)

## Search fallback

The `food_search_index_plan` test ran the production prepared statement against 50,003 live official rows with the default planner settings. Each range covers `official` and `all`, both on initial planning and after statement reuse. Broad, short, and punctuation-heavy searches examined the full catalog with warm buffers and returned 21 rows for a requested limit of 20, including the lookahead row. Selective name, brand, and alias queries used the search indexes without a sequential scan and took 0.056–0.145 ms.

| Query | Observed execution time | Proposed maximum per execution |
| --- | ---: | ---: |
| Broad (`lote`) | 558.920–609.505 ms | 750 ms |
| Short (`lo`) | 547.667–584.411 ms | 750 ms |
| Literal punctuation (`%_`) | 549.396–583.486 ms | 750 ms |

The budget applies to warm PostgreSQL execution time on this fixture, measured with `EXPLAIN (ANALYZE, BUFFERS)`. Rerun with `SQLX_OFFLINE=true cargo test -p server food_search_index_plan -- --ignored --nocapture` against an isolated PostgreSQL 17 database configured through `BALANCE_TEST_DATABASE_URL`.

## Index migration

The upgrade rehearsal used 50,003 live rows and one tombstone. A transaction held a `ROW EXCLUSIVE` lock for a scripted 1.2-second sleep. PostgreSQL reported the migration waiting for `SHARE` and a subsequent writer waiting for `ROW EXCLUSIVE`. The contended migration took 1.944 seconds in SQLx, and the queued writer completed in 1.884 seconds of wall time. The indexes permit reads while writes queue through transaction commit. An injected migration failure rolled back the DDL and preserved the previous migration ledger and schema fingerprint.

| Metric | Rehearsal measurement | Proposed maximum |
| --- | --- | --- |
| Migration lock acquisition | 1.2 s injected lock hold, with acquisition wait bounded by the 1.944 s total migration time | 1.5 s |
| Queued writer wall time | 1.884 s | 3 s |
| Uncontended build and commit | 0.935 s including standalone PostgreSQL startup and shutdown | 1.5 s |
| Combined on-disk index size | 4,931,584 bytes (4.70 MiB) | 6 MiB |
| 1,000-row insert execution time | 15.306 → 35.638 ms (2.33×) | 60 ms and 3× baseline |
| 1,000-row name and brand update execution time | 22.230 → 48.369 ms (2.18×) | 60 ms and 3× baseline |
| 1,000-row insert WAL | 430,408 → 1,259,242 bytes (2.93×) | 2 MiB and 4× baseline |
| 1,000-row name and brand update WAL | 485,631 → 1,502,964 bytes (3.09×) | 2 MiB and 4× baseline |

Write overhead was measured with `EXPLAIN (ANALYZE, BUFFERS, WAL)` before and after indexing. Each sample ran in a transaction that was rolled back. The WAL limits apply to the warm rehearsal without full-page images. Index storage is the sum of `pg_relation_size` for the two new indexes immediately after the upgrade. The original rehearsal observed lock queueing and did not time acquisition in isolation. The production change window needs separately approved timeouts for the target catalog.

## Local verification rerun

Standalone PostgreSQL 17 replayed the fresh and upgrade paths and reproduced the checked-in catalog, migration head, and schema fingerprint. The forced failure again preserved the prior schema and ledger. The production query used the search indexes for selective cases, and the fallback cases ranged from 555.954 to 642.969 ms. The uncontended upgrade took 0.827 s, the indexes occupied 4,923,392 bytes, and the indexed insert and update took 39.489 ms and 56.791 ms respectively. This rerun included full-page images in the WAL samples and could only use one database session. The warm WAL and contention measurements above come from the original multi-session rehearsal.
