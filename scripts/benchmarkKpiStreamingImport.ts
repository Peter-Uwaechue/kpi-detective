import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { streamRecords } from "../server/kpiImportWorker";

const rows = Number(process.env.KPI_BENCHMARK_ROWS || 500_000);
const outputDir = "/tmp/kpi-detective-benchmark";
const csvPath = join(outputDir, `kpi-${rows}.csv`);

async function buildSource() {
  await mkdir(outputDir, { recursive: true });
  const stream = createWriteStream(csvPath, { encoding: "utf8" });
  stream.write("Transaction Date,Revenue,Region,Product,Customer\n");
  for (let index = 0; index < rows; index++) {
    const month = String((index % 12) + 1).padStart(2, "0");
    const revenue = 100 + (index % 900);
    stream.write(`2025-${month}-${String((index % 28) + 1).padStart(2, "0")},${revenue},Region-${index % 12},Product-${index % 48},Customer-${index % 5000}\n`);
    if (index % 10_000 === 0 && !stream.write("")) await once(stream, "drain");
  }
  stream.end();
  await once(stream, "finish");
}

async function main() {
  await buildSource();
  const started = performance.now();
  const startRss = process.memoryUsage().rss;
  let processed = 0;
  let maxRss = startRss;
  for await (const row of streamRecords("benchmark.csv", createReadStream(csvPath))) {
    if (!row.Revenue || !row["Transaction Date"]) throw new Error("Streaming parser did not preserve a required field.");
    processed++;
    if (processed % 10_000 === 0) maxRss = Math.max(maxRss, process.memoryUsage().rss);
  }
  const seconds = (performance.now() - started) / 1000;
  const report = {
    rowsRequested: rows,
    rowsProcessed: processed,
    durationSeconds: Number(seconds.toFixed(2)),
    rowsPerSecond: Math.round(processed / seconds),
    startingRssMiB: Number((startRss / 1024 / 1024).toFixed(1)),
    peakRssMiB: Number((maxRss / 1024 / 1024).toFixed(1)),
    incrementalRssMiB: Number(((maxRss - startRss) / 1024 / 1024).toFixed(1)),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
