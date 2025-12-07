CREATE TABLE "constituencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"name" varchar(150) NOT NULL,
	"state_id" integer NOT NULL,
	CONSTRAINT "constituencies_number_name_unique" UNIQUE("number","name")
);
--> statement-breakpoint
CREATE TABLE "constituency_elections" (
	"bridge_id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"constituency_id" integer NOT NULL,
	"eligible_voters" double precision,
	"total_voters" double precision,
	CONSTRAINT "constituency_elections_constituency_id_year_unique" UNIQUE("constituency_id","year")
);
--> statement-breakpoint
CREATE TABLE "constituency_party_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"bridge_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"vote_type" integer NOT NULL,
	"votes" double precision,
	"percent" double precision,
	"prev_votes" double precision,
	"prev_percent" double precision,
	"diff_percent_pts" double precision,
	CONSTRAINT "constituency_party_votes_party_id_bridge_id_vote_type_unique" UNIQUE("party_id","bridge_id","vote_type")
);
--> statement-breakpoint
CREATE TABLE "direct_candidacy" (
	"person_id" integer NOT NULL,
	"year" integer NOT NULL,
	"constituency_id" integer NOT NULL,
	"first_votes" double precision,
	"previously_elected" boolean DEFAULT false NOT NULL,
	"party_id" integer NOT NULL,
	CONSTRAINT "direct_candidacy_person_id_year_pk" PRIMARY KEY("person_id","year")
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"year" integer PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "elections_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"short_name" varchar(120) NOT NULL,
	"long_name" varchar(200) NOT NULL,
	CONSTRAINT "parties_short_name_unique" UNIQUE("short_name")
);
--> statement-breakpoint
CREATE TABLE "party_list_candidacy" (
	"person_id" integer NOT NULL,
	"party_list_id" integer NOT NULL,
	"list_position" double precision,
	"previously_elected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "party_list_candidacy_person_id_party_list_id_pk" PRIMARY KEY("person_id","party_list_id")
);
--> statement-breakpoint
CREATE TABLE "party_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"state_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"vote_count" double precision NOT NULL,
	CONSTRAINT "party_lists_state_id_party_id_year_unique" UNIQUE("state_id","party_id","year")
);
--> statement-breakpoint
CREATE TABLE "persons" (
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
	"birth_place" text,
	"profession" text
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" serial PRIMARY KEY NOT NULL,
	"abbr" varchar(2) NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "states_abbr_unique" UNIQUE("abbr"),
	CONSTRAINT "states_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "constituencies" ADD CONSTRAINT "constituencies_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD CONSTRAINT "constituency_elections_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD CONSTRAINT "constituency_elections_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_party_votes" ADD CONSTRAINT "constituency_party_votes_bridge_id_constituency_elections_bridge_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."constituency_elections"("bridge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_party_votes" ADD CONSTRAINT "constituency_party_votes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_list_candidacy" ADD CONSTRAINT "party_list_candidacy_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_list_candidacy" ADD CONSTRAINT "party_list_candidacy_party_list_id_party_lists_id_fk" FOREIGN KEY ("party_list_id") REFERENCES "public"."party_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_lists" ADD CONSTRAINT "party_lists_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_lists" ADD CONSTRAINT "party_lists_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_lists" ADD CONSTRAINT "party_lists_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;