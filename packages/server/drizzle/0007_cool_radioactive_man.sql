CREATE TABLE "active_user_peaks" (
	"day" date PRIMARY KEY NOT NULL,
	"peak" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
