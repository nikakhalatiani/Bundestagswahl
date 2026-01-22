CREATE TABLE "constituency_structural_data" (
	"constituency_id" integer NOT NULL,
	"year" integer NOT NULL,
	"metric_key" varchar(120) NOT NULL,
	"value" double precision,
	CONSTRAINT "constituency_structural_data_constituency_id_year_metric_key_pk" PRIMARY KEY("constituency_id","year","metric_key")
);
--> statement-breakpoint
CREATE TABLE "structural_metrics" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"label" varchar(200) NOT NULL,
	"unit" varchar(80)
);
--> statement-breakpoint
ALTER TABLE "constituency_structural_data" ADD CONSTRAINT "constituency_structural_data_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_structural_data" ADD CONSTRAINT "constituency_structural_data_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_structural_data" ADD CONSTRAINT "constituency_structural_data_metric_key_structural_metrics_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."structural_metrics"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structural_data_year_idx" ON "constituency_structural_data" USING btree ("year");--> statement-breakpoint
CREATE INDEX "structural_data_metric_idx" ON "constituency_structural_data" USING btree ("metric_key");