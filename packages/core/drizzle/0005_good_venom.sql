CREATE TABLE "allowed_logins" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "allowed_logins_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"login" text NOT NULL,
	"invited_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'dev' NOT NULL;--> statement-breakpoint
ALTER TABLE "allowed_logins" ADD CONSTRAINT "allowed_logins_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_logins_login_idx" ON "allowed_logins" USING btree ("login");