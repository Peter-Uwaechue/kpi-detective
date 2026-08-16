CREATE TABLE `kpi_import_aggregates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`import_id` varchar(64) NOT NULL,
	`metric_column` varchar(255) NOT NULL,
	`period` varchar(20) NOT NULL,
	`dimension` varchar(255) NOT NULL,
	`segment` varchar(520) NOT NULL,
	`metric_total` decimal(24,4) NOT NULL,
	`record_count` bigint NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kpi_import_aggregates_id` PRIMARY KEY(`id`),
	CONSTRAINT `kpi_import_aggregates_key_uq` UNIQUE(`import_id`,`metric_column`,`period`,`dimension`,`segment`)
);
--> statement-breakpoint
CREATE TABLE `kpi_import_rows` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`import_id` varchar(64) NOT NULL,
	`row_number` bigint NOT NULL,
	`raw_values` json NOT NULL,
	`cleaned_values` json NOT NULL,
	`changes` json,
	`issues` json,
	`excluded` boolean NOT NULL DEFAULT false,
	`possible_duplicate` boolean NOT NULL DEFAULT false,
	`exact_duplicate` boolean NOT NULL DEFAULT false,
	`row_signature` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kpi_import_rows_id` PRIMARY KEY(`id`),
	CONSTRAINT `kpi_import_rows_import_row_uq` UNIQUE(`import_id`,`row_number`)
);
--> statement-breakpoint
CREATE TABLE `kpi_imports` (
	`id` varchar(64) NOT NULL,
	`owner_open_id` varchar(64),
	`original_file_name` varchar(520) NOT NULL,
	`content_type` varchar(180) NOT NULL,
	`storage_key` varchar(760) NOT NULL,
	`storage_url` text NOT NULL,
	`file_bytes` bigint NOT NULL,
	`status` enum('uploading','queued','profiling','ingesting','analyzing','complete','failed','cancelled') NOT NULL DEFAULT 'uploading',
	`processing_cursor` bigint NOT NULL DEFAULT 0,
	`source_row_count` bigint NOT NULL DEFAULT 0,
	`usable_row_count` bigint NOT NULL DEFAULT 0,
	`preview_row_count` bigint NOT NULL DEFAULT 0,
	`columns_json` json,
	`cleaning_summary_json` json,
	`analysis_json` json,
	`worker_checkpoint_json` json,
	`error_message` text,
	`attempt_count` int NOT NULL DEFAULT 0,
	`queued_at` timestamp,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kpi_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `kpi_import_aggregates_import_period_idx` ON `kpi_import_aggregates` (`import_id`,`period`);--> statement-breakpoint
CREATE INDEX `kpi_import_rows_import_signature_idx` ON `kpi_import_rows` (`import_id`,`row_signature`);--> statement-breakpoint
CREATE INDEX `kpi_imports_owner_status_idx` ON `kpi_imports` (`owner_open_id`,`status`);--> statement-breakpoint
CREATE INDEX `kpi_imports_status_created_idx` ON `kpi_imports` (`status`,`created_at`);