ALTER TABLE "constituency_party_votes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "federal_distribution_cache" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "party_summary_cache" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "seat_allocation_cache" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "state_distribution_cache" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "constituency_party_votes" CASCADE;--> statement-breakpoint
DROP TABLE "federal_distribution_cache" CASCADE;--> statement-breakpoint
DROP TABLE "party_summary_cache" CASCADE;--> statement-breakpoint
DROP TABLE "seat_allocation_cache" CASCADE;--> statement-breakpoint
DROP TABLE "state_distribution_cache" CASCADE;--> statement-breakpoint
ALTER TABLE "second_votes" ADD COLUMN "constituency_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "second_votes" ADD CONSTRAINT "second_votes_constituency_id_constituencies_id_fk" FOREIGN KEY ("constituency_id") REFERENCES "public"."constituencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "second_votes_constituency_idx" ON "second_votes" USING btree ("constituency_id");--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "total_voters";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "percent";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "prev_votes";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "prev_percent";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "diff_percent_pts";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "invalid_first";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "invalid_second";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "valid_first";--> statement-breakpoint
ALTER TABLE "constituency_elections" DROP COLUMN "valid_second";--> statement-breakpoint
ALTER TABLE "direct_candidacy" DROP COLUMN "first_votes";--> statement-breakpoint
ALTER TABLE "direct_candidacy" DROP COLUMN "previously_elected";--> statement-breakpoint
ALTER TABLE "party_list_candidacy" DROP COLUMN "previously_elected";--> statement-breakpoint
ALTER TABLE "party_lists" DROP COLUMN "vote_count";--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."federal_distribution_cache" AS (
    WITH RECURSIVE
    DirectCandidacyVotes AS (
        SELECT
            dc.person_id,
            dc.year,
            dc.constituency_id,
            dc.party_id,
            COUNT(fv.id) FILTER (WHERE fv.is_valid) AS first_votes
        FROM direct_candidacy dc
        LEFT JOIN first_votes fv
          ON fv.direct_person_id = dc.person_id
         AND fv.year = dc.year
        GROUP BY dc.person_id, dc.year, dc.constituency_id, dc.party_id
    ),
    PartyListVotes AS (
        SELECT
            pl.id AS party_list_id,
            pl.party_id,
            pl.state_id,
            pl.year,
            COUNT(sv.id) FILTER (WHERE sv.is_valid) AS second_votes
        FROM party_lists pl
        LEFT JOIN second_votes sv
          ON sv.party_list_id = pl.id
        GROUP BY pl.id, pl.party_id, pl.state_id, pl.year
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
    ConstituencyWinners AS (
        SELECT
            dc.party_id,
            dc.year,
            COUNT(*) AS count
        FROM DirectCandidacyVotes dc
        WHERE dc.first_votes = (
            SELECT MAX(dc2.first_votes)
            FROM DirectCandidacyVotes dc2
            WHERE dc2.constituency_id = dc.constituency_id
              AND dc2.year = dc.year
        )
        GROUP BY dc.party_id, dc.year
    ),
    QualifiedParties AS (
        SELECT
            nsv.party_id,
            nsv.short_name,
            nsv.total_second_votes,
            nsv.year
        FROM NationalSecondVotes nsv
        LEFT JOIN ConstituencyWinners cw
          ON cw.party_id = nsv.party_id
         AND cw.year = nsv.year
        LEFT JOIN TotalSecondVotes tsv
          ON tsv.year = nsv.year
        WHERE nsv.is_minority = TRUE
           OR COALESCE(cw.count, 0) >= 3
           OR (nsv.total_second_votes * 100.0 / NULLIF(tsv.total, 0)) >= 5
    ),
    Divisors AS (
        SELECT 1 AS divisor
        UNION ALL
        SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
    ),
    Quotients AS (
        SELECT
            qp.year,
            qp.party_id,
            qp.short_name,
            qp.total_second_votes,
            d.divisor,
            (qp.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifiedParties qp
        CROSS JOIN Divisors d
        WHERE qp.total_second_votes > 0
    ),
    RankedSeats AS (
        SELECT
            year,
            party_id,
            short_name,
            quotient,
            total_second_votes,
            ROW_NUMBER() OVER (
                PARTITION BY year
                ORDER BY quotient DESC, total_second_votes DESC, party_id ASC
            ) AS rank
        FROM Quotients
    )
    SELECT
        ROW_NUMBER() OVER () AS id,
        year,
        party_id,
        COUNT(*) AS seats,
        CURRENT_DATE AS created_at
    FROM RankedSeats
    WHERE rank <= 630
    GROUP BY year, party_id, short_name
    ORDER BY year, seats DESC
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_constituency_party_votes" AS (
    WITH first_party AS (
      SELECT
        dc.constituency_id,
        dc.year,
        dc.party_id,
        1::int AS vote_type,
        COUNT(fv.id) FILTER (WHERE fv.is_valid) AS votes
      FROM direct_candidacy dc
      LEFT JOIN first_votes fv
        ON fv.direct_person_id = dc.person_id
       AND fv.year = dc.year
      GROUP BY dc.constituency_id, dc.year, dc.party_id
    ),
    second_party AS (
      SELECT
        sv.constituency_id,
        pl.year,
        pl.party_id,
        2::int AS vote_type,
        COUNT(sv.id) FILTER (WHERE sv.is_valid) AS votes
      FROM second_votes sv
      JOIN party_lists pl
        ON pl.id = sv.party_list_id
      GROUP BY sv.constituency_id, pl.year, pl.party_id
    ),
    combined AS (
      SELECT * FROM first_party
      UNION ALL
      SELECT * FROM second_party
    ),
    first_totals AS (
      SELECT
        dc.constituency_id,
        fv.year,
        COUNT(*) FILTER (WHERE fv.is_valid) AS valid_first
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.year = fv.year
      GROUP BY dc.constituency_id, fv.year
    ),
    second_totals AS (
      SELECT
        sv.constituency_id,
        pl.year,
        COUNT(*) FILTER (WHERE sv.is_valid) AS valid_second
      FROM second_votes sv
      JOIN party_lists pl
        ON pl.id = sv.party_list_id
      GROUP BY sv.constituency_id, pl.year
    ),
    with_percent AS (
      SELECT
        c.constituency_id,
        c.year,
        c.party_id,
        c.vote_type,
        c.votes,
        CASE
          WHEN c.vote_type = 1 THEN (c.votes * 100.0 / NULLIF(COALESCE(ft.valid_first, 0), 0))
          ELSE (c.votes * 100.0 / NULLIF(COALESCE(st.valid_second, 0), 0))
        END AS percent
      FROM combined c
      LEFT JOIN first_totals ft
        ON ft.constituency_id = c.constituency_id
       AND ft.year = c.year
      LEFT JOIN second_totals st
        ON st.constituency_id = c.constituency_id
       AND st.year = c.year
    ),
    with_prev AS (
      SELECT
        cur.constituency_id,
        cur.year,
        cur.party_id,
        cur.vote_type,
        cur.votes,
        cur.percent,
        prev.votes AS prev_votes,
        prev.percent AS prev_percent,
        CASE
          WHEN prev.percent IS NULL THEN NULL
          ELSE cur.percent - prev.percent
        END AS diff_percent_pts
      FROM with_percent cur
      LEFT JOIN LATERAL (
        SELECT e2.year
        FROM elections e2
        WHERE e2.year < cur.year
        ORDER BY e2.year DESC
        LIMIT 1
      ) prev_year ON true
      LEFT JOIN with_percent prev
        ON prev.constituency_id = cur.constituency_id
       AND prev.party_id = cur.party_id
       AND prev.vote_type = cur.vote_type
       AND prev.year = prev_year.year
    )
    SELECT * FROM with_prev
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_constituency_stats" AS (
    WITH first_totals AS (
      SELECT
        dc.constituency_id,
        fv.year,
        COUNT(*) FILTER (WHERE fv.is_valid) AS valid_first,
        COUNT(*) FILTER (WHERE NOT fv.is_valid) AS invalid_first,
        COUNT(*) AS total_first
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.year = fv.year
      GROUP BY dc.constituency_id, fv.year
    ),
    second_totals AS (
      SELECT
        sv.constituency_id,
        pl.year,
        COUNT(*) FILTER (WHERE sv.is_valid) AS valid_second,
        COUNT(*) FILTER (WHERE NOT sv.is_valid) AS invalid_second,
        COUNT(*) AS total_second
      FROM second_votes sv
      JOIN party_lists pl
        ON pl.id = sv.party_list_id
      GROUP BY sv.constituency_id, pl.year
    )
    SELECT
      ce.constituency_id,
      ce.year,
      ce.eligible_voters,
      COALESCE(ft.total_first, 0) AS total_voters,
      CASE
        WHEN ce.eligible_voters IS NULL OR ce.eligible_voters = 0 THEN NULL
        ELSE (COALESCE(ft.total_first, 0) * 100.0 / ce.eligible_voters)
      END AS turnout_percent,
      COALESCE(ft.valid_first, 0) AS valid_first,
      COALESCE(ft.invalid_first, 0) AS invalid_first,
      COALESCE(st.valid_second, 0) AS valid_second,
      COALESCE(st.invalid_second, 0) AS invalid_second
    FROM constituency_elections ce
    LEFT JOIN first_totals ft
      ON ft.constituency_id = ce.constituency_id
     AND ft.year = ce.year
    LEFT JOIN second_totals st
      ON st.constituency_id = ce.constituency_id
     AND st.year = ce.year
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_direct_candidacy_votes" AS (
    SELECT
      dc.person_id,
      dc.year,
      dc.constituency_id,
      dc.party_id,
      COUNT(fv.id) FILTER (WHERE fv.is_valid) AS first_votes
    FROM direct_candidacy dc
    LEFT JOIN first_votes fv
      ON fv.direct_person_id = dc.person_id
     AND fv.year = dc.year
    GROUP BY dc.person_id, dc.year, dc.constituency_id, dc.party_id
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_party_list_votes" AS (
    SELECT
      pl.id AS party_list_id,
      pl.party_id,
      pl.state_id,
      pl.year,
      COUNT(sv.id) FILTER (WHERE sv.is_valid) AS second_votes
    FROM party_lists pl
    LEFT JOIN second_votes sv
      ON sv.party_list_id = pl.id
    GROUP BY pl.id, pl.party_id, pl.state_id, pl.year
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."party_summary_cache" AS (
    WITH RECURSIVE
    DirectCandidacyVotes AS (
        SELECT
            dc.person_id,
            dc.year,
            dc.constituency_id,
            dc.party_id,
            COUNT(fv.id) FILTER (WHERE fv.is_valid) AS first_votes
        FROM direct_candidacy dc
        LEFT JOIN first_votes fv
          ON fv.direct_person_id = dc.person_id
         AND fv.year = dc.year
        GROUP BY dc.person_id, dc.year, dc.constituency_id, dc.party_id
    ),
    PartyListVotes AS (
        SELECT
            pl.id AS party_list_id,
            pl.party_id,
            pl.state_id,
            pl.year,
            COUNT(sv.id) FILTER (WHERE sv.is_valid) AS second_votes
        FROM party_lists pl
        LEFT JOIN second_votes sv
          ON sv.party_list_id = pl.id
        GROUP BY pl.id, pl.party_id, pl.state_id, pl.year
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
    ConstituencyWinners AS (
        SELECT
            dcv.party_id,
            dcv.person_id,
            dcv.constituency_id,
            dcv.year,
            ROW_NUMBER() OVER (
                PARTITION BY dcv.constituency_id, dcv.year
                ORDER BY dcv.first_votes DESC, dcv.person_id ASC
            ) AS rank
        FROM DirectCandidacyVotes dcv
    ),
    ConstituencyWinnersPerParty AS (
        SELECT
            year,
            party_id,
            COUNT(*) AS count
        FROM ConstituencyWinners
        WHERE rank = 1
        GROUP BY year, party_id
    ),
    QualifiedParties AS (
        SELECT
            nsv.party_id,
            nsv.short_name,
            nsv.total_second_votes,
            COALESCE(cwp.count, 0) AS direct_mandates,
            nsv.is_minority,
            nsv.year,
            (nsv.total_second_votes * 100.0 / NULLIF(tsv.total, 0)) AS percent,
            CASE
                WHEN nsv.is_minority THEN TRUE
                WHEN COALESCE(cwp.count, 0) >= 3 THEN TRUE
                WHEN (nsv.total_second_votes * 100.0 / NULLIF(tsv.total, 0)) >= 5 THEN TRUE
                ELSE FALSE
            END AS qualified
        FROM NationalSecondVotes nsv
        LEFT JOIN ConstituencyWinnersPerParty cwp
          ON cwp.party_id = nsv.party_id
         AND cwp.year = nsv.year
        LEFT JOIN TotalSecondVotes tsv
          ON tsv.year = nsv.year
    )
    SELECT
        ROW_NUMBER() OVER () AS id,
        year,
        party_id,
        total_second_votes AS second_votes,
        ROUND(CAST(percent AS numeric), 2) AS percent_second_votes,
        direct_mandates,
        is_minority AS minority_party,
        qualified AS in_bundestag,
        CURRENT_DATE AS created_at
    FROM QualifiedParties
    WHERE total_second_votes > 0
    ORDER BY year, total_second_votes DESC
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."seat_allocation_cache" AS (
    WITH RECURSIVE
    DirectCandidacyVotes AS (
        SELECT
            dc.person_id,
            dc.year,
            dc.constituency_id,
            dc.party_id,
            COUNT(fv.id) FILTER (WHERE fv.is_valid) AS first_votes
        FROM direct_candidacy dc
        LEFT JOIN first_votes fv
          ON fv.direct_person_id = dc.person_id
         AND fv.year = dc.year
        GROUP BY dc.person_id, dc.year, dc.constituency_id, dc.party_id
    ),
    PartyListVotes AS (
        SELECT
            pl.id AS party_list_id,
            pl.party_id,
            pl.state_id,
            pl.year,
            COUNT(sv.id) FILTER (WHERE sv.is_valid) AS second_votes
        FROM party_lists pl
        LEFT JOIN second_votes sv
          ON sv.party_list_id = pl.id
        GROUP BY pl.id, pl.party_id, pl.state_id, pl.year
    ),
    ConstituencyStats AS (
        SELECT
            dcv.constituency_id,
            dcv.year,
            COALESCE(SUM(dcv.first_votes), 0) AS valid_first
        FROM DirectCandidacyVotes dcv
        GROUP BY dcv.constituency_id, dcv.year
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
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."state_distribution_cache" AS (
    WITH RECURSIVE
    DirectCandidacyVotes AS (
        SELECT
            dc.person_id,
            dc.year,
            dc.constituency_id,
            dc.party_id,
            COUNT(fv.id) FILTER (WHERE fv.is_valid) AS first_votes
        FROM direct_candidacy dc
        LEFT JOIN first_votes fv
          ON fv.direct_person_id = dc.person_id
         AND fv.year = dc.year
        GROUP BY dc.person_id, dc.year, dc.constituency_id, dc.party_id
    ),
    PartyListVotes AS (
        SELECT
            pl.id AS party_list_id,
            pl.party_id,
            pl.state_id,
            pl.year,
            COUNT(sv.id) FILTER (WHERE sv.is_valid) AS second_votes
        FROM party_lists pl
        LEFT JOIN second_votes sv
          ON sv.party_list_id = pl.id
        GROUP BY pl.id, pl.party_id, pl.state_id, pl.year
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
    ConstituencyWinners AS (
        SELECT dc.party_id, dc.year, COUNT(*) AS count
        FROM DirectCandidacyVotes dc
        WHERE dc.first_votes = (
            SELECT MAX(dc2.first_votes)
            FROM DirectCandidacyVotes dc2
            WHERE dc2.constituency_id = dc.constituency_id
              AND dc2.year = dc.year
        )
        GROUP BY dc.party_id, dc.year
    ),
    QualifiedParties AS (
        SELECT
            nsv.party_id,
            nsv.short_name,
            nsv.total_second_votes,
            nsv.year
        FROM NationalSecondVotes nsv
        LEFT JOIN ConstituencyWinners cw
          ON cw.party_id = nsv.party_id
         AND cw.year = nsv.year
        LEFT JOIN TotalSecondVotes tsv
          ON tsv.year = nsv.year
        WHERE nsv.is_minority = TRUE
           OR COALESCE(cw.count, 0) >= 3
           OR (nsv.total_second_votes * 100.0 / NULLIF(tsv.total, 0)) >= 5
    ),
    Divisors AS (
        SELECT 1 AS divisor
        UNION ALL
        SELECT divisor + 2 FROM Divisors WHERE divisor < 1260
    ),
    FederalQuotients AS (
        SELECT
            qp.year,
            qp.party_id,
            qp.short_name,
            qp.total_second_votes,
            d.divisor,
            (qp.total_second_votes * 1.0 / d.divisor) AS quotient
        FROM QualifiedParties qp
        CROSS JOIN Divisors d
        WHERE qp.total_second_votes > 0
    ),
    FederalRanked AS (
        SELECT
            year,
            party_id,
            short_name,
            quotient,
            total_second_votes,
            ROW_NUMBER() OVER (
                PARTITION BY year
                ORDER BY quotient DESC, total_second_votes DESC, party_id ASC
            ) AS rank
        FROM FederalQuotients
    ),
    FederalDistribution AS (
        SELECT
            year,
            party_id,
            short_name,
            COUNT(*) AS seats_national
        FROM FederalRanked
        WHERE rank <= 630
        GROUP BY year, party_id, short_name
    ),
    StateSecondVotes AS (
        SELECT
            plv.year,
            plv.party_id,
            plv.state_id,
            s.name AS state_name,
            p.short_name,
            plv.second_votes
        FROM PartyListVotes plv
        JOIN states s ON s.id = plv.state_id
        JOIN parties p ON p.id = plv.party_id
        WHERE plv.party_id IN (SELECT party_id FROM FederalDistribution fd WHERE fd.year = plv.year)
    ),
    StateQuotients AS (
        SELECT
            ssv.year,
            ssv.party_id,
            ssv.short_name,
            ssv.state_id,
            ssv.state_name,
            ssv.second_votes,
            d.divisor,
            (ssv.second_votes * 1.0 / d.divisor) AS quotient,
            fd.seats_national
        FROM StateSecondVotes ssv
        JOIN FederalDistribution fd
          ON fd.party_id = ssv.party_id
         AND fd.year = ssv.year
        CROSS JOIN Divisors d
    ),
    StateRanked AS (
        SELECT
            year,
            party_id,
            short_name,
            state_id,
            state_name,
            quotient,
            second_votes,
            seats_national,
            ROW_NUMBER() OVER (
                PARTITION BY year, party_id
                ORDER BY quotient DESC, second_votes DESC, state_id ASC
            ) AS rank
        FROM StateQuotients
    )
    SELECT
        ROW_NUMBER() OVER () AS id,
        year,
        party_id,
        state_id,
        COUNT(*) AS seats,
        CURRENT_DATE AS created_at
    FROM StateRanked
    WHERE rank <= seats_national
    GROUP BY year, party_id, short_name, state_id, state_name
    ORDER BY year, short_name, seats DESC
  ) WITH NO DATA;