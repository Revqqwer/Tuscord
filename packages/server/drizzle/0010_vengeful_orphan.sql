CREATE TABLE "desktop_downloads" (
	"id" bigint PRIMARY KEY NOT NULL,
	"ip" varchar(45) NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "desktop_downloads_created_idx" ON "desktop_downloads" USING btree ("created_at");