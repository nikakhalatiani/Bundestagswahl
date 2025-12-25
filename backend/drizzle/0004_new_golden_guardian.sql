CREATE TABLE "federal_distribution_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"party_id" integer NOT NULL,
	"seats" integer NOT NULL,
	"created_at" date DEFAULT now(),
	CONSTRAINT "federal_distribution_cache_year_party_id_unique" UNIQUE("year","party_id")
);
--> statement-breakpoint
CREATE TABLE "party_summary_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"party_id" integer NOT NULL,
	"second_votes" double precision NOT NULL,
	"percent_second_votes" double precision NOT NULL,
	"direct_mandates" integer DEFAULT 0 NOT NULL,
	"minority_party" boolean DEFAULT false NOT NULL,
	"in_bundestag" boolean DEFAULT false NOT NULL,
	"created_at" date DEFAULT now(),
	CONSTRAINT "party_summary_cache_year_party_id_unique" UNIQUE("year","party_id")
);
--> statement-breakpoint
CREATE TABLE "seat_allocation_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"person_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"state_id" integer NOT NULL,
	"seat_type" varchar(50) NOT NULL,
	"constituency_name" varchar(150),
	"list_position" double precision,
	"percent_first_votes" double precision,
	"created_at" date DEFAULT now(),
	CONSTRAINT "seat_allocation_cache_year_person_id_unique" UNIQUE("year","person_id")
);
--> statement-breakpoint
CREATE TABLE "state_distribution_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"party_id" integer NOT NULL,
	"state_id" integer NOT NULL,
	"seats" integer NOT NULL,
	"created_at" date DEFAULT now(),
	CONSTRAINT "state_distribution_cache_year_party_id_state_id_unique" UNIQUE("year","party_id","state_id")
);
--> statement-breakpoint
ALTER TABLE "federal_distribution_cache" ADD CONSTRAINT "federal_distribution_cache_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federal_distribution_cache" ADD CONSTRAINT "federal_distribution_cache_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_summary_cache" ADD CONSTRAINT "party_summary_cache_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_summary_cache" ADD CONSTRAINT "party_summary_cache_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_allocation_cache" ADD CONSTRAINT "seat_allocation_cache_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_allocation_cache" ADD CONSTRAINT "seat_allocation_cache_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_allocation_cache" ADD CONSTRAINT "seat_allocation_cache_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_allocation_cache" ADD CONSTRAINT "seat_allocation_cache_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_distribution_cache" ADD CONSTRAINT "state_distribution_cache_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_distribution_cache" ADD CONSTRAINT "state_distribution_cache_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_distribution_cache" ADD CONSTRAINT "state_distribution_cache_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_federal_dist_year" ON "federal_distribution_cache" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_party_summary_year" ON "party_summary_cache" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_party_summary_bundestag" ON "party_summary_cache" USING btree ("year","in_bundestag");--> statement-breakpoint
CREATE INDEX "idx_seat_cache_year" ON "seat_allocation_cache" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_seat_cache_party" ON "seat_allocation_cache" USING btree ("party_id","year");--> statement-breakpoint
CREATE INDEX "idx_seat_cache_state" ON "seat_allocation_cache" USING btree ("state_id","year");--> statement-breakpoint
CREATE INDEX "idx_seat_cache_type" ON "seat_allocation_cache" USING btree ("seat_type","year");--> statement-breakpoint
CREATE INDEX "idx_state_dist_year" ON "state_distribution_cache" USING btree ("year");--> statement-breakpoint
CREATE INDEX "idx_state_dist_party" ON "state_distribution_cache" USING btree ("party_id","year");--> statement-breakpoint
CREATE INDEX "idx_state_dist_state" ON "state_distribution_cache" USING btree ("state_id","year");