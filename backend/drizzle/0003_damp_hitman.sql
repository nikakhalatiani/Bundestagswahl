ALTER TABLE "constituency_elections" ADD COLUMN "percent" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "prev_votes" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "prev_percent" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "diff_percent_pts" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "invalid_first" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "invalid_second" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "valid_first" double precision;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD COLUMN "valid_second" double precision;