ALTER TYPE "public"."post_status" ADD VALUE 'scheduled';--> statement-breakpoint
ALTER TABLE "post_candidates" ADD COLUMN "theme_group" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_candidates" ADD COLUMN "theme" text;--> statement-breakpoint
ALTER TABLE "post_candidates" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "post_candidates" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
CREATE INDEX "post_candidates_due_idx" ON "post_candidates" USING btree ("status","scheduled_for");