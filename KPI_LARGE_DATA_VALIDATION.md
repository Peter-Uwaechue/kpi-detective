# KPI Detective Large-Data Validation

## Implemented architecture

KPI Detective now has a backend import design that removes the 25,000-row browser limit. The browser creates a signed direct upload, uploads the raw CSV/XLSX to object storage, and polls an authenticated import job. A separate worker streams the file, stores row-level review data and aggregate contributions in the database, and returns only paginated rows and aggregate analysis to the dashboard.

The `View cleaned data` interface is constrained to **100 rows per backend page**. It never receives the full imported file.

## Measured parser validation

The streaming parser was tested locally using generated CSV fixtures. These tests validate the parser’s bounded-memory behavior only; they do not claim a complete end-to-end worker/database throughput result because a production object-storage bucket and MySQL database are not configured in this sandbox.

| Test | Records parsed | Duration | Throughput | Start RSS | Peak RSS | Incremental RSS |
|---|---:|---:|---:|---:|---:|---:|
| Streaming CSV parser | 500,000 | 2.61 seconds | 191,205 rows/sec | 233.9 MiB | 234.9 MiB | 1.1 MiB |
| Streaming CSV parser | 1,000,000 | 5.39 seconds | 185,701 rows/sec | 234.2 MiB | 234.8 MiB | 0.6 MiB |

The test used `scripts/benchmarkKpiStreamingImport.ts`, which feeds a file stream to the same `streamRecords` code used by the worker. It does not construct an in-memory row array.

## Required production configuration

A live multi-million-row import requires the following before it can be enabled on the public deployment:

| Requirement | Purpose |
|---|---|
| MySQL-compatible `DATABASE_URL` | Stores import jobs, review rows, checkpoints, and aggregates |
| Private S3-compatible bucket | Holds raw CSV/XLSX files; direct browser upload avoids the function payload ceiling |
| Dedicated worker service | Runs `pnpm start:kpi-worker` with at least 4 GiB RAM and 2 vCPUs |
| Dashboard environment variables | Allows signed-upload creation, job polling, and paginated preview queries |
| Applied migrations | Creates `kpi_imports`, `kpi_import_rows`, and `kpi_import_aggregates` |

## Real operating limits

There is intentionally **no browser row-count limit**. The actual ceiling is determined by the storage quota, database quota, worker memory/CPU, file width, and distinct categorical values. The reference worker configuration is 4 GiB RAM, 2 vCPUs, 1,000-row transactions, and 100-row UI pages. It is designed for several hundred thousand to a few million CSV rows per import.

The current Vercel app cannot itself be the import worker: Vercel function request bodies are limited to 4.5 MB, Hobby functions use 2 GB / 1 vCPU, and Hobby function duration is limited to 300 seconds. The Vercel dashboard remains appropriate as the UI/API control plane; it should not proxy raw uploads or execute the complete import.

Sources:

1. https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
2. https://vercel.com/docs/functions/configuring-functions/memory
3. https://vercel.com/docs/functions/configuring-functions/duration

## Browser verification

On 16 August 2026, the locally built app was opened at `/kpi-detective` and verified through the sample-data journey. The landing page displayed the private-upload sign-in control alongside the public sample dataset. The sample then progressed through cleaning review and the full dashboard, including KPI headline, confidence score, counterfactual explanation, contribution chart, cause cards, history, report actions, and analyst chat.

The remote-import path was intentionally not executed in this environment because its required private bucket, production database, and continuously running worker service have not yet been configured.

## Security controls

Backend import creation, upload completion, status lookup, preview pagination, and retry actions require an authenticated owner. Import records are filtered by the owner’s identity. Browser uploads use short-lived signed object-storage URLs; raw files are not proxied through the web application.

Deduplication now relies on a unique `(import_id, row_signature)` database constraint. The worker checks each 1,000-row batch against that persistent signature index before writing aggregate contributions, so duplicate detection does not retain a full-file `Set` in worker memory.

## Build and test status

`pnpm check` and `pnpm build` pass, including the dedicated worker bundle. The repository-wide `pnpm test` result is **57 passing and 9 failing**. All nine failures are inherited SSR expectations for Willers Solutions routes and job-posting structured data that no longer exist in this intentionally standalone KPI application; they do not exercise the KPI Detective page or worker. These obsolete tests should be removed or replaced in the standalone repository as a separate test-suite maintenance task.
