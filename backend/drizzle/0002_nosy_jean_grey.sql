CREATE TABLE "first_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"direct_person_id" integer NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"created_at" date DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "second_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_list_id" integer NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"created_at" date DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "first_votes" ADD CONSTRAINT "fk_first_vote_direct_cand" FOREIGN KEY ("direct_person_id","year") REFERENCES "public"."direct_candidacy"("person_id","year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_votes" ADD CONSTRAINT "second_votes_party_list_id_party_lists_id_fk" FOREIGN KEY ("party_list_id") REFERENCES "public"."party_lists"("id") ON DELETE cascade ON UPDATE no action;