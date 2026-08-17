CREATE TYPE "public"."kpi_import_status" AS ENUM('uploading', 'queued', 'profiling', 'ingesting', 'analyzing', 'complete', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "candidate_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"jobSlug" varchar(180) NOT NULL,
	"jobTitle" varchar(260) NOT NULL,
	"referrerName" varchar(180) NOT NULL,
	"referrerEmail" varchar(320) NOT NULL,
	"candidateName" varchar(180) NOT NULL,
	"candidateEmail" varchar(320) NOT NULL,
	"candidateLinkedin" varchar(520),
	"rationale" text NOT NULL,
	"cvFileName" varchar(255) NOT NULL,
	"cvMimeType" varchar(120) NOT NULL,
	"cvStorageKey" varchar(520) NOT NULL,
	"cvUrl" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_import_aggregates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_id" varchar(64) NOT NULL,
	"metric_column" varchar(255) NOT NULL,
	"period" varchar(20) NOT NULL,
	"dimension" varchar(255) NOT NULL,
	"segment" varchar(520) NOT NULL,
	"metric_total" numeric(24, 4) NOT NULL,
	"record_count" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_import_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_id" varchar(64) NOT NULL,
	"row_number" bigint NOT NULL,
	"raw_values" jsonb NOT NULL,
	"cleaned_values" jsonb NOT NULL,
	"changes" jsonb,
	"issues" jsonb,
	"excluded" boolean DEFAULT false NOT NULL,
	"possible_duplicate" boolean DEFAULT false NOT NULL,
	"exact_duplicate" boolean DEFAULT false NOT NULL,
	"row_signature" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_imports" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"owner_open_id" varchar(128),
	"original_file_name" varchar(520) NOT NULL,
	"content_type" varchar(180) NOT NULL,
	"storage_key" varchar(760) NOT NULL,
	"storage_url" text NOT NULL,
	"file_bytes" bigint NOT NULL,
	"status" "kpi_import_status" DEFAULT 'uploading' NOT NULL,
	"processing_cursor" bigint DEFAULT 0 NOT NULL,
	"source_row_count" bigint DEFAULT 0 NOT NULL,
	"usable_row_count" bigint DEFAULT 0 NOT NULL,
	"preview_row_count" bigint DEFAULT 0 NOT NULL,
	"columns_json" jsonb,
	"cleaning_summary_json" jsonb,
	"analysis_json" jsonb,
	"worker_checkpoint_json" jsonb,
	"error_message" text,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leadership_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(140) NOT NULL,
	"name" varchar(180) NOT NULL,
	"title" varchar(220) NOT NULL,
	"organisation" varchar(220) NOT NULL,
	"portraitUrl" text NOT NULL,
	"portraitKey" varchar(520),
	"linkedinUrl" varchar(520),
	"quote" text,
	"biography" text NOT NULL,
	"sectors" text NOT NULL,
	"expertise" text NOT NULL,
	"displayOrder" integer DEFAULT 0 NOT NULL,
	"isPublished" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leadership_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(128) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_import_aggregates_key_uq" ON "kpi_import_aggregates" USING btree ("import_id","metric_column","period","dimension","segment");--> statement-breakpoint
CREATE INDEX "kpi_import_aggregates_import_period_idx" ON "kpi_import_aggregates" USING btree ("import_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_import_rows_import_row_uq" ON "kpi_import_rows" USING btree ("import_id","row_number");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_import_rows_import_signature_uq" ON "kpi_import_rows" USING btree ("import_id","row_signature");--> statement-breakpoint
CREATE INDEX "kpi_imports_owner_status_idx" ON "kpi_imports" USING btree ("owner_open_id","status");--> statement-breakpoint
CREATE INDEX "kpi_imports_status_queued_idx" ON "kpi_imports" USING btree ("status","queued_at");