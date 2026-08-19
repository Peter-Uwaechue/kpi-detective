# Importer capability fixtures

`real-world-import-capability-matrix.csv` is the permanent, versioned regression fixture for KPI Detective’s production importer. The importer test streams this CSV through `streamRecords()`, profiles all columns, cleans every row, and asserts the resulting date, identifier, and numeric classifications.

| Capability family | Fixture coverage |
|---|---|
| Rendered dates and date-times | ISO, ISO timestamps, day-first and month-first slash dates, named dates, named dates with AM/PM, and slash dates with times. |
| Spreadsheet serial dates | 1900-system Excel/Google Sheets serial values. |
| Epoch timestamps | Unix seconds, milliseconds, and microseconds. |
| Reporting dates | Compact `YYYYMMDD`, compact `YYYYMM`, `YYYY-MM`, `Month YYYY`, and calendar-quarter forms. |
| Component dates | Separate Year, Month, and Day values, producing a derived date profile. |
| Identifiers | Leading-zero customer IDs, order IDs, SKUs, and epoch-shaped transaction IDs that must remain identifiers. |
| Numeric values | Currency symbols and codes, decimal comma/grouping styles, spaces, parentheses negatives, trailing negatives, CR/DR suffixes, leading-zero amounts, scientific notation, and K/M/B-style abbreviations. |
| Spreadsheet cells | Native XLSX date cells, serial cells, and cached formula results are additionally covered in the importer test file. |

The fixture does not claim to interpret every locale or proprietary vendor encoding. In particular, raw CSV serials cannot disclose whether a source used Excel’s older 1904 epoch, and a date order that is genuinely ambiguous with no contextual evidence cannot be resolved with certainty. Those cases must remain transparent rather than silently guessed.
