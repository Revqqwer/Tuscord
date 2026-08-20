CREATE TABLE "bot_applications" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner_id" bigint NOT NULL,
	"bot_user_id" bigint NOT NULL,
	"name" varchar(32) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_applications" ADD CONSTRAINT "bot_applications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_applications" ADD CONSTRAINT "bot_applications_bot_user_id_users_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_applications_bot_user_id_key" ON "bot_applications" USING btree ("bot_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_applications_token_hash_key" ON "bot_applications" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "bot_applications_owner_idx" ON "bot_applications" USING btree ("owner_id");