CREATE TABLE "structural_data" (
	"constituency_id" integer PRIMARY KEY NOT NULL,
	"foreigner_pct" double precision,
	"disposable_income" double precision
);
--> statement-breakpoint
ALTER TABLE "structural_data" ADD CONSTRAINT "structural_data_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE cascade ON UPDATE no action;