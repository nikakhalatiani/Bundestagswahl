DROP MATERIALIZED VIEW IF EXISTS "public"."seat_allocation_cache";--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "public"."mv_constituency_vote_totals";--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "public"."mv_constituency_first_votes";--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "public"."mv_constituency_second_votes";--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "public"."mv_constituency_invalid_votes";--> statement-breakpoint
DROP MATERIALIZED VIEW IF EXISTS "public"."mv_party_list_votes";--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_constituency_party_votes" AS (
    WITH first_party AS (
      SELECT
        dcv.constituency_id,
        dcv.year,
        dcv.party_id,
        1::int AS vote_type,
        COALESCE(SUM(dcv.first_votes), 0) AS votes
      FROM mv_direct_candidacy_votes dcv
      GROUP BY dcv.constituency_id, dcv.year, dcv.party_id
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
    )
    SELECT * FROM first_party
    UNION ALL
    SELECT * FROM second_party
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_constituency_elections" AS (
    WITH valid_totals AS (
      SELECT
        constituency_id,
        year,
        COALESCE(SUM(CASE WHEN vote_type = 1 THEN votes ELSE 0 END), 0) AS valid_first,
        COALESCE(SUM(CASE WHEN vote_type = 2 THEN votes ELSE 0 END), 0) AS valid_second
      FROM mv_constituency_party_votes
      GROUP BY constituency_id, year
    ),
    invalid_first AS (
      SELECT
        dc.constituency_id,
        fv.year,
        COUNT(*) AS invalid_first
      FROM first_votes fv
      JOIN direct_candidacy dc
        ON dc.person_id = fv.direct_person_id
       AND dc.year = fv.year
      WHERE fv.is_valid = false
      GROUP BY dc.constituency_id, fv.year
    ),
    invalid_second AS (
      SELECT
        sv.constituency_id,
        pl.year,
        COUNT(*) AS invalid_second
      FROM second_votes sv
      JOIN party_lists pl
        ON pl.id = sv.party_list_id
      WHERE sv.is_valid = false
      GROUP BY sv.constituency_id, pl.year
    )
    SELECT
      COALESCE(vt.constituency_id, i1.constituency_id, i2.constituency_id) AS constituency_id,
      COALESCE(vt.year, i1.year, i2.year) AS year,
      COALESCE(vt.valid_first, 0) AS valid_first,
      COALESCE(vt.valid_second, 0) AS valid_second,
      COALESCE(i1.invalid_first, 0) AS invalid_first,
      COALESCE(i2.invalid_second, 0) AS invalid_second
    FROM valid_totals vt
    FULL OUTER JOIN invalid_first i1
      ON i1.constituency_id = vt.constituency_id
     AND i1.year = vt.year
    FULL OUTER JOIN invalid_second i2
      ON i2.constituency_id = COALESCE(vt.constituency_id, i1.constituency_id)
     AND i2.year = COALESCE(vt.year, i1.year)
  ) WITH NO DATA;--> statement-breakpoint
CREATE MATERIALIZED VIEW "public"."mv_party_list_votes" AS (
    WITH state_votes AS (
      SELECT
        c.state_id,
        cpv.party_id,
        cpv.year,
        COALESCE(SUM(cpv.votes), 0) AS second_votes
      FROM mv_constituency_party_votes cpv
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
CREATE MATERIALIZED VIEW "public"."seat_allocation_cache" AS (
    WITH RECURSIVE
    DirectCandidacyVotes AS (
        SELECT
            person_id,
            year,
            constituency_id,
            party_id,
            first_votes
        FROM mv_direct_candidacy_votes
    ),
    PartyListVotes AS (
        SELECT
            party_list_id,
            party_id,
            state_id,
            year,
            second_votes
        FROM mv_party_list_votes
    ),
    ConstituencyStats AS (
        SELECT
            constituency_id,
            year,
            COALESCE(valid_first, 0) AS valid_first
        FROM mv_constituency_elections
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
