ALTER TABLE "tickets" ADD COLUMN "number" serial NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_number_unique" UNIQUE("number");