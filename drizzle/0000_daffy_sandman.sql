CREATE TABLE "source_documents" (
	"key" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"capability" text NOT NULL,
	"args" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_leases" (
	"key" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_series" (
	"connection_id" text NOT NULL,
	"capability" text NOT NULL,
	"environment" text NOT NULL,
	"entity" text NOT NULL,
	"metric" text NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "source_series_connection_id_capability_environment_entity_metric_bucket_at_pk" PRIMARY KEY("connection_id","capability","environment","entity","metric","bucket_at")
);
--> statement-breakpoint
CREATE INDEX "source_series_window" ON "source_series" USING btree ("connection_id","capability","environment","bucket_at");