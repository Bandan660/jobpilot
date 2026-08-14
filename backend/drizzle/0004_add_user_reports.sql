-- `user_reports` was declared in schema.ts when the issue reporter shipped and
-- never created in the database. Reporting has therefore never worked: zod
-- validated the request, the insert hit a table that does not exist, and
-- onError turned the failure into "Something went wrong" — which is the same
-- message every other unhandled error produces, so nothing pointed at the
-- cause. The panel showed it under a filled-in form, on the one screen a user
-- reaches specifically because something else is already broken.
--
-- Same shape of mistake as 0001_add_linkedin_ats: a declaration in TypeScript
-- is not a change to Postgres. Adding a table or an enum value to schema.ts
-- means writing the migration in the same commit.
--
-- ON DELETE set null, matching the schema: a report outlives the account that
-- filed it. The email is stored separately for exactly that reason, so a
-- deleted user's report is still answerable.
CREATE TABLE IF NOT EXISTS "user_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" text,
	"category" text DEFAULT 'bug' NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"page_url" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_reports_created_idx" ON "user_reports" USING btree ("created_at");
