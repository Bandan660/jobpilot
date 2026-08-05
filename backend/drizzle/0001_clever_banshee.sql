CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"preferred_name" text,
	"email" text,
	"phone" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"linkedin_url" text,
	"github_url" text,
	"portfolio_url" text,
	"other_url" text,
	"current_company" text,
	"current_title" text,
	"authorized_to_work" boolean,
	"requires_sponsorship" boolean,
	"willing_to_relocate" boolean,
	"notice_period" text,
	"salary_expectation" text,
	"referral_source" text,
	"experience" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"education" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"saved_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"demographics" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_user_idx" ON "profiles" USING btree ("user_id");