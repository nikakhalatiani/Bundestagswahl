CREATE INDEX "constituencies_state_idx" ON "constituencies" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "party_lists_state_idx" ON "party_lists" USING btree ("state_id");