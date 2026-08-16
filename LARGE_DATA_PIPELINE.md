# KPI Detective: Large-Data Processing Architecture

## Objective

KPI Detective must process data in the backend rather than retaining complete uploads in browser memory. The browser is limited to upload progress, job status, and a small paginated preview. Raw files are stored in object storage; cleaned records, profiles, job checkpoints, and aggregate KPI contributions are stored in the database.

## Processing flow

| Stage | Responsibility | Data location | Browser memory impact |
|---|---|---|---|
| Direct upload | The browser uploads the original CSV/XLSX directly to private object storage with a short-lived signed URL. | Object storage | Streams file bytes; no workbook parsing |
| Import creation | The application records filename, object key, owner, and upload state; it is marked `queued` only after object-storage metadata is verified. | Database | Tiny metadata response only |
| Worker profiling pass | A dedicated worker streams the file to infer columns, date formats, numeric formats, category mappings, duplicate signatures, and robust numeric statistics. | Worker + database checkpoints | Bounded by one batch |
| Worker ingestion pass | The worker streams records again, cleans them, records row-level review state, and writes batched aggregates by month, dimension, and value. | Database + object storage | Bounded by the configured batch size |
| Analysis | The application computes the KPI, contribution rankings, trends, confidence, and counterfactuals from aggregate tables. | Database | Only aggregate result returned |
| Preview | The application requests 100 rows at a time with bounded offset pagination. | Database | At most one preview page |

## Capacity contract

The application must not impose a row-count ceiling in the browser. The operative limit is the configured worker capacity and the available storage/database quota.

The default worker profile is intentionally explicit:

| Resource | Default worker target | Reason |
|---|---:|---|
| Memory | 4 GiB | Keeps parsing, type inference, category maps, and batch buffers within a bounded server budget |
| CPU | 2 vCPUs | Supports streaming parse, cleaning, and aggregate writes without tying up the web application |
| Raw-object storage | At least 25 GiB | Retains original uploads independently of database rows |
| Database | At least 50 GiB | Stores job metadata, rows required for review, and aggregate data |
| Row write batch | 1,000 records | Bounds transaction size and permits checkpoint/retry |
| Preview page | 100 rows | Keeps the dashboard responsive regardless of import size |

At this profile, the system is designed for several hundred thousand to a few million **CSV rows** per import. It deliberately uses no browser row limit. Actual capacity is measured in uploaded bytes, distinct categorical values, and database/storage quotas—not row count alone. A file with 1,000,000 short rows can be easier than 300,000 rows containing many high-cardinality category values or wide JSON-like cells.

## Hosting boundary

The interactive dashboard can remain on Vercel. Vercel functions should only create signed uploads, read job status, retrieve preview pages, and query completed aggregates. They must not proxy raw file bytes or execute full imports.

The worker must run in a separate container or service with persistent queue access. It receives storage and database credentials only through environment variables. It never sends complete datasets back to the browser.

## Supported source formats

CSV is the primary large-data format because it supports true streaming. XLSX is processed with a streaming workbook reader. Legacy XLS files are accepted only when a streaming reader is available in the worker runtime; otherwise the interface must explain that conversion to CSV/XLSX is required rather than silently loading the file in the browser.

## Data safety and retries

Each import has a stable UUID, status, checkpoint cursor, attempt count, and error field. Rows and aggregates are associated with the import ID. Queue claims are conditional on the `queued` state, preventing multiple worker replicas from processing the same job. Checkpoints report completed batches; a retry deliberately restarts the source after clearing that import’s partial rows and aggregates, which provides a correct result without claiming unimplemented mid-file seek/resume support. Raw uploads are not stored in database BLOB columns.

## Deployment requirements

The dedicated worker requires the following environment variables, supplied through the worker host and the dashboard API host:

```text
DATABASE_URL
KPI_S3_REGION
KPI_S3_BUCKET
KPI_S3_ACCESS_KEY_ID
KPI_S3_SECRET_ACCESS_KEY
KPI_S3_ENDPOINT              # optional for S3-compatible storage such as R2
KPI_IMPORT_BATCH_SIZE        # optional; defaults to 1000
KPI_IMPORT_WORKER_POLL_MS    # optional; defaults to 5000
```

No storage credential is exposed to the browser. The browser receives only a short-lived signed upload URL.

## Verification plan

1. Load-test the streaming CSV worker with 100,000, 500,000, and 1,000,000 synthetic rows in the worker environment.
2. Confirm peak process memory remains below the configured worker memory allocation.
3. Confirm the browser requests no more than 100 preview rows per page.
4. Confirm analysis results are generated from database aggregates rather than a browser-held dataset.
5. Record measured duration, peak memory, uploaded bytes, and completed rows for each test.

## Current Vercel constraints (verified August 2026)

Vercel functions reject request bodies above 4.5 MB, so raw business files must upload directly to object storage rather than through the dashboard API. Vercel documents a default 2 GB / 1 vCPU function envelope and a maximum function duration of 300 seconds on the Hobby plan. Those limits are suitable for job orchestration and paginated API reads, not for a dependable multi-million-row import worker.

Sources:

1. https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
2. https://vercel.com/docs/functions/configuring-functions/memory
3. https://vercel.com/docs/functions/configuring-functions/duration
