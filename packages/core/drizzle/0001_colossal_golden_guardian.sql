DROP INDEX "github_installations_installation_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_user_installation_idx" ON "github_installations" USING btree ("user_id","installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_chat_idx" ON "users" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE INDEX "github_installations_installation_idx" ON "github_installations" USING btree ("installation_id");