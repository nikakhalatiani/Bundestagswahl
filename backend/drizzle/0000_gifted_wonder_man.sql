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
	CONSTRAINT "constituency_elections_constituency_id_year_unique" UNIQUE("constituency_id","year")
);
--> statement-breakpoint
CREATE TABLE "constituency_structural_data" (
	"constituency_election_id" integer NOT NULL,
	"metric_key" varchar(120) NOT NULL,
	"value" double precision,
	CONSTRAINT "constituency_structural_data_constituency_election_id_metric_key_pk" PRIMARY KEY("constituency_election_id","metric_key")
);
--> statement-breakpoint
CREATE TABLE "direct_candidacy" (
	"person_id" integer NOT NULL,
	"constituency_election_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	CONSTRAINT "direct_candidacy_person_id_constituency_election_id_pk" PRIMARY KEY("person_id","constituency_election_id")
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"year" integer PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	CONSTRAINT "elections_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "first_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"direct_person_id" integer NOT NULL,
	"constituency_election_id" integer NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"created_at" date DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"short_name" varchar(120) NOT NULL,
	"long_name" varchar(200) NOT NULL,
	"is_minority" boolean DEFAULT false NOT NULL,
	CONSTRAINT "parties_short_name_unique" UNIQUE("short_name")
);
--> statement-breakpoint
CREATE TABLE "party_list_candidacy" (
	"person_id" integer NOT NULL,
	"party_list_id" integer NOT NULL,
	"list_position" double precision,
	CONSTRAINT "party_list_candidacy_person_id_party_list_id_pk" PRIMARY KEY("person_id","party_list_id")
);
--> statement-breakpoint
CREATE TABLE "party_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"state_id" integer NOT NULL,
	"party_id" integer NOT NULL,
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
CREATE TABLE "second_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"party_list_id" integer NOT NULL,
	"constituency_election_id" integer NOT NULL,
	"is_valid" boolean DEFAULT true NOT NULL,
	"created_at" date DEFAULT now()
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
CREATE TABLE "structural_metrics" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"label" varchar(200) NOT NULL,
	"unit" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "voting_codes" (
	"code" varchar(64) PRIMARY KEY NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"constituency_election_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "constituencies" ADD CONSTRAINT "constituencies_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD CONSTRAINT "constituency_elections_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_elections" ADD CONSTRAINT "constituency_elections_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_structural_data" ADD CONSTRAINT "constituency_structural_data_constituency_election_id_constituency_elections_bridge_id_fk" FOREIGN KEY ("constituency_election_id") REFERENCES "public"."constituency_elections"("bridge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constituency_structural_data" ADD CONSTRAINT "constituency_structural_data_metric_key_structural_metrics_key_fk" FOREIGN KEY ("metric_key") REFERENCES "public"."structural_metrics"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_constituency_election_id_constituency_elections_bridge_id_fk" FOREIGN KEY ("constituency_election_id") REFERENCES "public"."constituency_elections"("bridge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_candidacy" ADD CONSTRAINT "direct_candidacy_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_votes" ADD CONSTRAINT "fk_first_vote_direct_cand" FOREIGN KEY ("direct_person_id","constituency_election_id") REFERENCES "public"."direct_candidacy"("person_id","constituency_election_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_list_candidacy" ADD CONSTRAINT "party_list_candidacy_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_list_candidacy" ADD CONSTRAINT "party_list_candidacy_party_list_id_party_lists_id_fk" FOREIGN KEY ("party_list_id") REFERENCES "public"."party_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_lists" ADD CONSTRAINT "party_lists_year_elections_year_fk" FOREIGN KEY ("year") REFERENCES "public"."elections"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_lists" ADD CONSTRAINT "party_lists_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_lists" ADD CONSTRAINT "party_lists_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_votes" ADD CONSTRAINT "second_votes_party_list_id_party_lists_id_fk" FOREIGN KEY ("party_list_id") REFERENCES "public"."party_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "second_votes" ADD CONSTRAINT "second_votes_constituency_election_id_constituency_elections_bridge_id_fk" FOREIGN KEY ("constituency_election_id") REFERENCES "public"."constituency_elections"("bridge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voting_codes" ADD CONSTRAINT "voting_codes_constituency_election_id_constituency_elections_bridge_id_fk" FOREIGN KEY ("constituency_election_id") REFERENCES "public"."constituency_elections"("bridge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "constituencies_state_idx" ON "constituencies" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "structural_data_constituency_election_idx" ON "constituency_structural_data" USING btree ("constituency_election_id");--> statement-breakpoint
CREATE INDEX "structural_data_metric_idx" ON "constituency_structural_data" USING btree ("metric_key");--> statement-breakpoint
CREATE INDEX "direct_candidacy_constituency_election_idx" ON "direct_candidacy" USING btree ("constituency_election_id");--> statement-breakpoint
CREATE INDEX "first_votes_constituency_election_idx" ON "first_votes" USING btree ("constituency_election_id");--> statement-breakpoint
CREATE INDEX "party_lists_state_idx" ON "party_lists" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "second_votes_party_idx" ON "second_votes" USING btree ("party_list_id");--> statement-breakpoint
CREATE INDEX "second_votes_constituency_election_idx" ON "second_votes" USING btree ("constituency_election_id");--> statement-breakpoint
CREATE INDEX "voting_codes_constituency_election_idx" ON "voting_codes" USING btree ("constituency_election_id");--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_00_direct_candidacy_votes" AS (
    SELECT
      dc.person_id,
      dc.constituency_election_id,
      ce.year,
      ce.constituency_id,
      dc.party_id,
      COUNT(fv.id) FILTER (WHERE fv.is_valid) AS first_votes
    FROM direct_candidacy dc
    JOIN constituency_elections ce
      ON ce.bridge_id = dc.constituency_election_id
    LEFT JOIN first_votes fv
      ON fv.direct_person_id = dc.person_id
     AND fv.constituency_election_id = dc.constituency_election_id
    GROUP BY dc.person_id, dc.constituency_election_id, ce.year, ce.constituency_id, dc.party_id
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_01_constituency_party_votes" AS (
    WITH first_party AS (
      SELECT
        dcv.constituency_election_id,
        dcv.constituency_id,
        dcv.year,
        dcv.party_id,
        1::int AS vote_type,
        COALESCE(SUM(dcv.first_votes), 0) AS votes
      FROM mv_00_direct_candidacy_votes dcv
      GROUP BY dcv.constituency_election_id, dcv.constituency_id, dcv.year, dcv.party_id
    ),
    second_party AS (
      SELECT
        sv.constituency_election_id,
        ce.constituency_id,
        ce.year,
        pl.party_id,
        2::int AS vote_type,
        COUNT(sv.id) FILTER (WHERE sv.is_valid) AS votes
      FROM second_votes sv
      JOIN constituency_elections ce
        ON ce.bridge_id = sv.constituency_election_id
      JOIN party_lists pl
        ON pl.id = sv.party_list_id
       AND pl.year = ce.year
      GROUP BY sv.constituency_election_id, ce.constituency_id, ce.year, pl.party_id
    )
    SELECT * FROM first_party
    UNION ALL
    SELECT * FROM second_party
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_02_party_list_votes" AS (
    WITH state_votes AS (
      SELECT
        c.state_id,
        cpv.party_id,
        cpv.year,
        COALESCE(SUM(cpv.votes), 0) AS second_votes
      FROM mv_01_constituency_party_votes cpv
      JOIN constituencies c ON c.id = cpv.constituency_id
      WHERE cpv.vote_type = 2
      GROUP BY c.state_id, cpv.party_id, cpv.year
    )
    SELECT
      pl.id AS party_list_id,
      pl.party_id,
      pl.state_id,
      pl.year,
      COALESCE(sv.second_votes, 0) AS second_votes
    FROM party_lists pl
    LEFT JOIN state_votes sv
      ON sv.state_id = pl.state_id
     AND sv.party_id = pl.party_id
     AND sv.year = pl.year
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_03_constituency_elections" AS (
    WITH valid_totals AS (
      SELECT
        constituency_election_id,
        constituency_id,
        year,
        COALESCE(SUM(CASE WHEN vote_type = 1 THEN votes ELSE 0 END), 0) AS valid_first,
        COALESCE(SUM(CASE WHEN vote_type = 2 THEN votes ELSE 0 END), 0) AS valid_second
      FROM mv_01_constituency_party_votes
      GROUP BY constituency_election_id, constituency_id, year
    ),
    invalid_first AS (
      SELECT
        dc.constituency_election_id,
        ce.constituency_id,
        ce.year,
        COUNT(*) AS invalid_first
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.constituency_election_id = fv.constituency_election_id
      JOIN constituency_elections ce
        ON ce.bridge_id = dc.constituency_election_id
      WHERE fv.is_valid = false
      GROUP BY dc.constituency_election_id, ce.constituency_id, ce.year
    ),
    invalid_second AS (
      SELECT
        sv.constituency_election_id,
        ce.constituency_id,
        ce.year,
        COUNT(*) AS invalid_second
      FROM second_votes sv
      JOIN constituency_elections ce
        ON ce.bridge_id = sv.constituency_election_id
      WHERE sv.is_valid = false
      GROUP BY sv.constituency_election_id, ce.constituency_id, ce.year
    )
    SELECT
      COALESCE(vt.constituency_election_id, i1.constituency_election_id, i2.constituency_election_id) AS constituency_election_id,
      COALESCE(vt.constituency_id, i1.constituency_id, i2.constituency_id) AS constituency_id,
      COALESCE(vt.year, i1.year, i2.year) AS year,
      COALESCE(vt.valid_first, 0) AS valid_first,
      COALESCE(vt.valid_second, 0) AS valid_second,
      COALESCE(i1.invalid_first, 0) AS invalid_first,
      COALESCE(i2.invalid_second, 0) AS invalid_second
    FROM valid_totals vt
    FULL OUTER JOIN invalid_first i1
      ON i1.constituency_election_id = vt.constituency_election_id
    FULL OUTER JOIN invalid_second i2
      ON i2.constituency_election_id = COALESCE(vt.constituency_election_id, i1.constituency_election_id)
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."seat_allocation_cache" AS (
    WITH RECURSIVE
    DirectCandidacyVotes AS (
        SELECT
            person_id,
            year,
            constituency_id,
            party_id,
            first_votes
        FROM mv_00_direct_candidacy_votes
    ),
    PartyListVotes AS (
        SELECT
            party_list_id,
            party_id,
            state_id,
            year,
            second_votes
        FROM mv_02_party_list_votes
    ),
    ConstituencyStats AS (
        SELECT
            constituency_id,
            year,
            COALESCE(valid_first, 0) AS valid_first
        FROM mv_03_constituency_elections
    ),
    ConstituencyFirstVotes AS (
        SELECT
            dcv.constituency_id,
            dcv.year,
            dcv.person_id,
            dcv.party_id,
            dcv.first_votes,
            c.name AS constituency_name,
            c.state_id,
            ROW_NUMBER() OVER (
                PARTITION BY dcv.constituency_id, dcv.year
                ORDER BY dcv.first_votes DESC, dcv.person_id ASC
            ) AS rank
        FROM DirectCandidacyVotes dcv
        JOIN constituencies c ON c.id = dcv.constituency_id
    ),
    ConstituencyWinners AS (
        SELECT
            constituency_id,
            year,
            person_id,
            party_id,
            first_votes,
            constituency_name,
            state_id
        FROM ConstituencyFirstVotes
        WHERE rank = 1
    ),
    NationalSecondVotes AS (
        SELECT
            p.id AS party_id,
            p.short_name,
            p.is_minority,
            e.year,
            COALESCE(SUM(plv.second_votes), 0) AS total_second_votes
        FROM elections e
        CROSS JOIN parties p
        LEFT JOIN PartyListVotes plv
          ON plv.party_id = p.id
         AND plv.year = e.year
        GROUP BY p.id, p.short_name, p.is_minority, e.year
    ),
    TotalSecondVotes AS (
        SELECT year, SUM(total_second_votes) AS total
        FROM NationalSecondVotes
        GROUP BY year
    ),
    ConstituencyWinnersPerParty AS (
        SELECT
            year,
            party_id,
            COUNT(*) AS num_winners
        FROM ConstituencyWinners
        GROUP BY year, party_id
    ),
    QualifiedParties AS (
        SELECT
            nsv.party_id,
            nsv.short_name,
            nsv.total_second_votes,
            COALESCE(cwp.num_winners, 0) AS num_direct_mandates,
            nsv.is_minority,
            nsv.year,
            (nsv.total_second_votes * 100.0 / NULLIF(tsv.total, 0)) AS percent_second_votes,
            CASE
                WHEN nsv.is_minority THEN TRUE
                WHEN COALESCE(cwp.num_winners, 0) >= 3 THEN TRUE
                WHEN (nsv.total_second_votes * 100.0 / NULLIF(tsv.total, 0)) >= 5 THEN TRUE
                ELSE FALSE
            END AS is_qualified
        FROM NationalSecondVotes nsv
        LEFT JOIN ConstituencyWinnersPerParty cwp
          ON cwp.party_id = nsv.party_id
         AND cwp.year = nsv.year
        LEFT JOIN TotalSecondVotes tsv
          ON tsv.year = nsv.year
    ),
    DirectSeatsNonQualified AS (
        SELECT
            cw.person_id,
            cw.constituency_id,
            cw.constituency_name,
            cw.party_id,
            cw.first_votes,
            cw.state_id,
            cw.year,
            p.short_name AS party_name,
            'Direct Mandate (Non-Qualified Party)' AS seat_type
        FROM ConstituencyWinners cw
        JOIN parties p ON p.id = cw.party_id
        JOIN QualifiedParties qp
          ON qp.party_id = cw.party_id
         AND qp.year = cw.year
        WHERE qp.is_qualified = FALSE
    ),
    NumDirectSeatsNonQualified AS (
        SELECT year, COUNT(*) AS count
        FROM DirectSeatsNonQualified
        GROUP BY year
    ),
    AvailableSeats AS (
        SELECT
            e.year,
            630 - COALESCE(nd.count, 0) AS seats
        FROM elections e
        LEFT JOIN NumDirectSeatsNonQualified nd ON nd.year = e.year
    ),
    QualifiedSecondVotes AS (
        SELECT
            year,
            party_id,
            short_name,
            total_second_votes
        FROM QualifiedParties
        WHERE is_qualified = TRUE AND total_second_votes > 0
    ),
    Divisors AS (
        SELECT 1 AS divisor
        UNION ALL
        SELECT divisor + 2
        FROM Divisors
        WHERE divisor < 1260
    ),
    FederalDistributionQuotients AS (
        SELECT
            qsv.year,
            qsv.party_id,
            qsv.short_name,
            qsv.total_second_votes,
            d.divisor,
            (qsv.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifiedSecondVotes qsv
        CROSS JOIN Divisors d
    ),
    FederalDistributionRanked AS (
        SELECT
            year,
            party_id,
            short_name,
            quotient,
            total_second_votes,
            ROW_NUMBER() OVER (
                PARTITION BY year
                ORDER BY quotient DESC, total_second_votes DESC, party_id ASC
            ) AS seat_number
        FROM FederalDistributionQuotients
    ),
    FederalDistribution AS (
        SELECT
            fdr.year,
            fdr.party_id,
            fdr.short_name,
            COUNT(*) AS seats_national
        FROM FederalDistributionRanked fdr
        JOIN AvailableSeats a ON a.year = fdr.year
        WHERE fdr.seat_number <= a.seats
        GROUP BY fdr.year, fdr.party_id, fdr.short_name
    ),
    StateListSecondVotes AS (
        SELECT
            plv.year,
            plv.party_id,
            plv.state_id,
            s.name AS state_name,
            p.short_name AS party_name,
            plv.second_votes AS state_second_votes
        FROM PartyListVotes plv
        JOIN states s ON s.id = plv.state_id
        JOIN parties p ON p.id = plv.party_id
        WHERE plv.party_id IN (
            SELECT party_id FROM FederalDistribution fd WHERE fd.year = plv.year
        )
    ),
    StateDistributionQuotients AS (
        SELECT
            slsv.year,
            slsv.party_id,
            slsv.party_name,
            slsv.state_id,
            slsv.state_name,
            slsv.state_second_votes,
            d.divisor,
            (slsv.state_second_votes * 1.0 / d.divisor) AS quotient,
            fd.seats_national
        FROM StateListSecondVotes slsv
        JOIN FederalDistribution fd
          ON fd.party_id = slsv.party_id
         AND fd.year = slsv.year
        CROSS JOIN Divisors d
    ),
    StateDistributionRanked AS (
        SELECT
            year,
            party_id,
            party_name,
            state_id,
            state_name,
            state_second_votes,
            quotient,
            seats_national,
            ROW_NUMBER() OVER (
                PARTITION BY year, party_id
                ORDER BY quotient DESC, state_second_votes DESC, state_id ASC
            ) AS seat_number
        FROM StateDistributionQuotients
    ),
    StateDistribution AS (
        SELECT
            year,
            party_id,
            party_name,
            state_id,
            state_name,
            COUNT(*) AS seats_state
        FROM StateDistributionRanked sdr
        WHERE seat_number <= seats_national
        GROUP BY year, party_id, party_name, state_id, state_name
    ),
    QualifiedConstituencyWinners AS (
        SELECT
            cw.person_id,
            cw.constituency_id,
            cw.constituency_name,
            cw.party_id,
            cw.first_votes,
            cw.state_id,
            cw.year,
            p.short_name AS party_name,
            (cw.first_votes * 100.0 / NULLIF(COALESCE(cs.valid_first, 0), 0)) AS percent_first_votes
        FROM ConstituencyWinners cw
        JOIN parties p ON p.id = cw.party_id
        JOIN QualifiedParties qp
          ON qp.party_id = cw.party_id
         AND qp.year = cw.year
         AND qp.is_qualified = TRUE
        LEFT JOIN ConstituencyStats cs
          ON cs.constituency_id = cw.constituency_id
         AND cs.year = cw.year
    ),
    DirectMandatesRankedPerState AS (
        SELECT
            qcw.*,
            ROW_NUMBER() OVER (
                PARTITION BY qcw.year, qcw.party_id, qcw.state_id
                ORDER BY qcw.percent_first_votes DESC, qcw.first_votes DESC, qcw.person_id ASC
            ) AS rank_in_state
        FROM QualifiedConstituencyWinners qcw
    ),
    DirectMandatesWithSeat AS (
        SELECT
            dmr.person_id,
            dmr.constituency_id,
            dmr.constituency_name,
            dmr.party_id,
            dmr.first_votes,
            dmr.state_id,
            dmr.party_name,
            dmr.percent_first_votes,
            dmr.rank_in_state,
            dmr.year
        FROM DirectMandatesRankedPerState dmr
        JOIN StateDistribution sd
          ON sd.party_id = dmr.party_id
         AND sd.state_id = dmr.state_id
         AND sd.year = dmr.year
        WHERE dmr.rank_in_state <= sd.seats_state
    ),
    DirectMandatesPerPartyState AS (
        SELECT
            year,
            party_id,
            state_id,
            COUNT(*) AS num_direct_mandates
        FROM DirectMandatesWithSeat
        GROUP BY year, party_id, state_id
    ),
    ListSeatsPerPartyState AS (
        SELECT
            sd.year,
            sd.party_id,
            sd.party_name,
            sd.state_id,
            sd.state_name,
            sd.seats_state,
            COALESCE(dmps.num_direct_mandates, 0) AS direct_mandates,
            GREATEST(0, sd.seats_state - COALESCE(dmps.num_direct_mandates, 0)) AS list_seats
        FROM StateDistribution sd
        LEFT JOIN DirectMandatesPerPartyState dmps
          ON dmps.party_id = sd.party_id
         AND dmps.state_id = sd.state_id
         AND dmps.year = sd.year
    ),
    ListCandidatesRanked AS (
        SELECT
            plc.person_id,
            plc.party_list_id,
            plc.list_position,
            pl.party_id,
            pl.state_id,
            pl.year,
            p.short_name AS party_name,
            s.name AS state_name,
            per.first_name,
            per.last_name,
            ROW_NUMBER() OVER (
                PARTITION BY pl.year, pl.party_id, pl.state_id
                ORDER BY plc.list_position ASC
            ) AS rank
        FROM party_list_candidacy plc
        JOIN party_lists pl ON pl.id = plc.party_list_id
        JOIN parties p ON p.id = pl.party_id
        JOIN states s ON s.id = pl.state_id
        JOIN persons per ON per.id = plc.person_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM DirectMandatesWithSeat dms
            WHERE dms.person_id = plc.person_id
              AND dms.year = pl.year
        )
        AND pl.party_id IN (
            SELECT party_id FROM FederalDistribution fd WHERE fd.year = pl.year
        )
    ),
    ListSeatWinners AS (
        SELECT
            lcr.person_id,
            lcr.party_id,
            lcr.state_id,
            lcr.party_name,
            lcr.state_name,
            lcr.first_name,
            lcr.last_name,
            lcr.list_position,
            lcr.year,
            'List Seat' AS seat_type
        FROM ListCandidatesRanked lcr
        JOIN ListSeatsPerPartyState lspps
          ON lspps.party_id = lcr.party_id
         AND lspps.state_id = lcr.state_id
         AND lspps.year = lcr.year
        WHERE lcr.rank <= lspps.list_seats
    ),
    AllSeats AS (
        SELECT
            year,
            person_id,
            party_id,
            state_id,
            constituency_name AS constituency_name,
            NULL::double precision AS list_position,
            'Direct Mandate' AS seat_type,
            percent_first_votes
        FROM DirectMandatesWithSeat
        UNION ALL
        SELECT
            year,
            person_id,
            party_id,
            state_id,
            NULL AS constituency_name,
            list_position,
            seat_type,
            NULL::double precision AS percent_first_votes
        FROM ListSeatWinners
        UNION ALL
        SELECT
            year,
            person_id,
            party_id,
            state_id,
            constituency_name AS constituency_name,
            NULL::double precision AS list_position,
            seat_type,
            NULL::double precision AS percent_first_votes
        FROM DirectSeatsNonQualified
    )
    SELECT
        ROW_NUMBER() OVER () AS id,
        year,
        person_id,
        party_id,
        state_id,
        seat_type,
        constituency_name,
        list_position,
        percent_first_votes,
        CURRENT_DATE AS created_at
    FROM AllSeats
    ORDER BY year, party_id, seat_type, constituency_name NULLS LAST, list_position NULLS LAST
  ) WITH NO DATA;