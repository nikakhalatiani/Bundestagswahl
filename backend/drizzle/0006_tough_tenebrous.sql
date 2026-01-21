DROP TABLE "structural_data" CASCADE;--> statement-breakpoint
ALTER TABLE "constituencies" ADD COLUMN "foreigner_pct" double precision;--> statement-breakpoint
ALTER TABLE "constituencies" ADD COLUMN "disposable_income" double precision;