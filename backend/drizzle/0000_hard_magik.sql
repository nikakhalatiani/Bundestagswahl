CREATE TABLE "ballots" (
	"id" serial PRIMARY KEY NOT NULL,
	"constituency_num" integer NOT NULL,
	"voter_id" integer NOT NULL,
	"first_vote_candidate_id" integer,
	"second_vote_party" varchar(120),
	"is_first_vote_valid" boolean DEFAULT true NOT NULL,
	"is_second_vote_valid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text,
	"name_addition" text,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"artist_name" text,
	"gender" text,
	"birth_year" integer,
	"postal_code" text,
	"city" text,
	"city_state_abbr" text,
	"birth_place" text,
	"profession" text,
	"party_short_name" varchar(120),
	"list_position" double precision,
	"constituency_num" integer,
	"first_votes" double precision
);
--> statement-breakpoint
CREATE TABLE "constituencies" (
	"number" integer PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"state_id" varchar(5) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"short_name" varchar(120) PRIMARY KEY NOT NULL,
	"long_name" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_parties" (
	"state_id" varchar(5) NOT NULL,
	"party_short_name" varchar(120) NOT NULL,
	"second_votes" double precision NOT NULL,
	CONSTRAINT "state_parties_state_id_party_short_name_pk" PRIMARY KEY("state_id","party_short_name")
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" varchar(5) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_constituency_num_constituencies_number_fk" FOREIGN KEY ("constituency_num") REFERENCES "public"."constituencies"("number") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_first_vote_candidate_id_candidates_id_fk" FOREIGN KEY ("first_vote_candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_party_short_name_parties_short_name_fk" FOREIGN KEY ("party_short_name") REFERENCES "public"."parties"("short_name") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_constituency_num_constituencies_number_fk" FOREIGN KEY ("constituency_num") REFERENCES "public"."constituencies"("number") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "constituencies" ADD CONSTRAINT "constituencies_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "state_parties" ADD CONSTRAINT "state_parties_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "state_parties" ADD CONSTRAINT "state_parties_party_short_name_parties_short_name_fk" FOREIGN KEY ("party_short_name") REFERENCES "public"."parties"("short_name") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ballots_constituency_num_idx" ON "ballots" USING btree ("constituency_num");--> statement-breakpoint
CREATE INDEX "ballots_first_vote_candidate_id_idx" ON "ballots" USING btree ("first_vote_candidate_id");--> statement-breakpoint
CREATE INDEX "ballots_second_vote_party_idx" ON "ballots" USING btree ("second_vote_party");