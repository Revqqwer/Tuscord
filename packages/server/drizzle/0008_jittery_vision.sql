CREATE TABLE "ticket_messages" (
	"id" bigint PRIMARY KEY NOT NULL,
	"ticket_id" bigint NOT NULL,
	"author_type" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"email" varchar(254) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_user_id" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_resolved_user_idx" ON "reports" USING btree ("resolved_user_id","created_at");