DROP INDEX `kpi_imports_status_created_idx` ON `kpi_imports`;--> statement-breakpoint
CREATE INDEX `kpi_imports_status_queued_idx` ON `kpi_imports` (`status`,`queued_at`);