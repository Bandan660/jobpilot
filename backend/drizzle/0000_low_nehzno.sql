CREATE TYPE "public"."application_source" AS ENUM('EXTENSION_AUTO', 'EXTENSION_MANUAL', 'WEB_MANUAL', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('SAVED', 'APPLIED', 'SCREEN', 'INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'GHOSTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."ats_provider" AS ENUM('GREENHOUSE', 'LEVER', 'ASHBY', 'WORKDAY', 'ICIMS', 'SMARTRECRUITERS', 'GENERIC');--> statement-breakpoint
CREATE TYPE "public"."event_actor" AS ENUM('USER', 'EXTENSION', 'SYSTEM', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('CREATED', 'STATUS_CHANGED', 'POSTING_CHECKED', 'NOTE_ADDED', 'CONTACT_ADDED', 'DUPLICATE_FLAGGED', 'FOLLOW_UP_DUE');--> statement-breakpoint
CREATE TYPE "public"."posting_status" AS ENUM('LIVE', 'REMOVED', 'CLOSED', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"actor" "event_actor" NOT NULL,
	"from_status" "application_status",
	"to_status" "application_status",
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"title_slug" text NOT NULL,
	"location" text,
	"remote" boolean,
	"job_url" text,
	"job_url_canonical" text,
	"external_id" text,
	"ats" "ats_provider",
	"comp_min_cents" integer,
	"comp_max_cents" integer,
	"comp_currency" text,
	"comp_raw" text,
	"status" "application_status" DEFAULT 'SAVED' NOT NULL,
	"source" "application_source" DEFAULT 'EXTENSION_AUTO' NOT NULL,
	"applied_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"posting_status" "posting_status" DEFAULT 'UNKNOWN' NOT NULL,
	"posting_checked_at" timestamp with time zone,
	"posting_check_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text,
	"linkedin_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contacts" ADD CONSTRAINT "contacts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_events_app_idx" ON "application_events" USING btree ("application_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_events_type_idx" ON "application_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "applications_user_url_idx" ON "applications" USING btree ("user_id","job_url_canonical") WHERE "applications"."job_url_canonical" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_user_role_idx" ON "applications" USING btree ("user_id","company_id","title_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_user_status_idx" ON "applications" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_posting_sweep_idx" ON "applications" USING btree ("posting_checked_at") WHERE "applications"."posting_status" in ('LIVE', 'UNKNOWN');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_company_stats_idx" ON "applications" USING btree ("company_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "companies_slug_idx" ON "companies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_app_idx" ON "contacts" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_app_idx" ON "notes" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree (lower("email"));