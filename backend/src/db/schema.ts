import { sql } from "drizzle-orm";
import {
  pgTable,
  pgMaterializedView,
  serial,
  integer,
  bigint,
  varchar,
  text,
  doublePrecision,
  boolean,
  date,
  primaryKey,
  unique,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";

// ---------- States ----------
export const states = pgTable("states", {
  id: serial("id").primaryKey(),        // e.g. 1,2,3,...  ("StateID" in CSV)
  abbr: varchar("abbr", { length: 2 }).notNull().unique(), // e.g. "BB", "BE"
  name: varchar("name", { length: 100 }).notNull().unique(), // "Brandenburg"
});

// ---------- Parties ----------
export const parties = pgTable("parties", {
  id: serial("id").primaryKey(),                // "PartyID"
  short_name: varchar("short_name", { length: 120 }).notNull().unique(),
  long_name: varchar("long_name", { length: 200 }).notNull(),
  is_minority: boolean("is_minority").default(false).notNull(),
});

// ---------- Elections ----------
export const elections = pgTable("elections", {
  year: integer("year").primaryKey(),
  date: date("date").notNull().unique(),
});

// ---------- Constituencies ----------
export const constituencies = pgTable("constituencies", {
  id: serial("id").primaryKey(),               // "ConstituencyID"
  number: integer("number").notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  state_id: integer("state_id")
    .notNull()
    .references(() => states.id, { onDelete: "restrict", onUpdate: "cascade" }),
},
  (table) => [
    unique().on(table.number, table.name),
    index("constituencies_state_idx").on(table.state_id),
  ]);

// ---------- Structural Metrics ----------
export const structuralMetrics = pgTable("structural_metrics", {
  key: varchar("key", { length: 120 }).primaryKey(),
  label: varchar("label", { length: 200 }).notNull(),
  unit: varchar("unit", { length: 80 }),
});

export const constituencyStructuralData = pgTable("constituency_structural_data", {
  constituency_id: integer("constituency_id")
    .notNull()
    .references(() => constituencies.id, { onDelete: "cascade" }),
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  metric_key: varchar("metric_key", { length: 120 })
    .notNull()
    .references(() => structuralMetrics.key, { onDelete: "cascade" }),
  value: doublePrecision("value"),
},
  (table) => [
    primaryKey({ columns: [table.constituency_id, table.year, table.metric_key] }),
    index("structural_data_year_idx").on(table.year),
    index("structural_data_metric_idx").on(table.metric_key),
  ]);

// ---------- Persons (Candidates) ----------
export const persons = pgTable("persons", {
  id: serial("id").primaryKey(), // "PersonID"
  title: text("title"),
  name_addition: text("name_addition"),
  last_name: text("last_name").notNull(),
  first_name: text("first_name").notNull(),
  artist_name: text("artist_name"),
  gender: text("gender"),
  birth_year: integer("birth_year"),
  postal_code: text("postal_code"),
  city: text("city"),
  birth_place: text("birth_place"),
  profession: text("profession"),
},
);

// ---------- Party Lists (Landeslisten) ----------
export const partyLists = pgTable("party_lists", {
  id: serial("id").primaryKey(), // PartyListID
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  state_id: integer("state_id")
    .notNull()
    .references(() => states.id, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
},
  (table) => [
    unique().on(table.state_id, table.party_id, table.year),
    index("party_lists_state_idx").on(table.state_id),
  ]
);

// ---------- Direct Candidacy ----------
export const directCandidacy = pgTable("direct_candidacy", {
  person_id: integer("person_id")
    .notNull()
    .references(() => persons.id, { onDelete: "cascade" }),
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  constituency_id: integer("constituency_id")
    .notNull()
    .references(() => constituencies.id, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
},
  (table) => [
    primaryKey({ columns: [table.person_id, table.year] }),
  ]);

// ---------- Party List Candidacy ----------
export const partyListCandidacy = pgTable("party_list_candidacy", {
  person_id: integer("person_id")
    .notNull()
    .references(() => persons.id, { onDelete: "cascade" }),
  party_list_id: integer("party_list_id")
    .notNull()
    .references(() => partyLists.id, { onDelete: "cascade" }),
  list_position: doublePrecision("list_position"),
},
  (table) => [
    primaryKey({ columns: [table.person_id, table.party_list_id] }),
  ]);

// ---------- Constituency Elections ----------
export const constituencyElections = pgTable("constituency_elections", {
  bridge_id: serial("bridge_id").primaryKey(),    // BridgeID
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  constituency_id: integer("constituency_id")
    .notNull()
    .references(() => constituencies.id, { onDelete: "cascade" }),
  eligible_voters: doublePrecision("eligible_voters"),
},
  (table) => [
    unique().on(table.constituency_id, table.year),
  ]);

export const firstVotes = pgTable("first_votes", {
  id: serial("id").primaryKey(),
  year: integer("year")
    .notNull(),
  direct_person_id: integer("direct_person_id")
    .notNull(),
  is_valid: boolean("is_valid").default(true).notNull(),
  created_at: date("created_at").defaultNow(),
},
  (table) => [
    foreignKey({
      columns: [table.direct_person_id, table.year],
      foreignColumns: [
        directCandidacy.person_id,
        directCandidacy.year,
      ],
      name: "fk_first_vote_direct_cand",
    }),
  ]

);

export const secondVotes = pgTable("second_votes", {
  id: serial("id").primaryKey(),
  // each second vote is for a party list in some state
  party_list_id: integer("party_list_id")
    .notNull()
    .references(() => partyLists.id, { onDelete: "cascade" }),
  constituency_id: integer("constituency_id")
    .notNull()
    .references(() => constituencies.id, { onDelete: "cascade" }),
  is_valid: boolean("is_valid").default(true).notNull(),
  created_at: date("created_at").defaultNow(),
},
  (t) => [
    index("second_votes_party_idx").on(t.party_list_id),
    index("second_votes_constituency_idx").on(t.constituency_id),
  ]
);

// ---------- Voting Codes ----------
// This table is intentionally not connected to votes to preserve voter anonymity.
export const votingCodes = pgTable("voting_codes", {
  code: varchar("code", { length: 64 }).primaryKey(),
  is_used: boolean("is_used").default(false).notNull(),
  constituency_election_id: integer("constituency_election_id")
    .notNull()
    .references(() => constituencyElections.bridge_id, { onDelete: "cascade" }),
},
  (table) => [
    index("voting_codes_constituency_election_idx").on(table.constituency_election_id),
  ]
);

// ---------- Materialized Views ----------

export const mv00DirectCandidacyVotes = pgMaterializedView("mv_00_direct_candidacy_votes", {
  person_id: integer("person_id"),
  year: integer("year"),
  constituency_id: integer("constituency_id"),
  party_id: integer("party_id"),
  first_votes: bigint("first_votes", { mode: "number" }),
})
  .withNoData()
  .as(sql`
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
  `);

export const mv01ConstituencyPartyVotes = pgMaterializedView("mv_01_constituency_party_votes", {
  constituency_id: integer("constituency_id"),
  year: integer("year"),
  party_id: integer("party_id"),
  vote_type: integer("vote_type"),
  votes: bigint("votes", { mode: "number" }),
})
  .withNoData()
  .as(sql`
    WITH first_party AS (
      SELECT
        dcv.constituency_id,
        dcv.year,
        dcv.party_id,
        1::int AS vote_type,
        COALESCE(SUM(dcv.first_votes), 0) AS votes
      FROM mv_00_direct_candidacy_votes dcv
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
  `);

export const mv02PartyListVotes = pgMaterializedView("mv_02_party_list_votes", {
  party_list_id: integer("party_list_id"),
  party_id: integer("party_id"),
  state_id: integer("state_id"),
  year: integer("year"),
  second_votes: bigint("second_votes", { mode: "number" }),
})
  .withNoData()
  .as(sql`
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
  `);

export const mv03ConstituencyElections = pgMaterializedView("mv_03_constituency_elections", {
  constituency_id: integer("constituency_id"),
  year: integer("year"),
  valid_first: bigint("valid_first", { mode: "number" }),
  valid_second: bigint("valid_second", { mode: "number" }),
  invalid_first: bigint("invalid_first", { mode: "number" }),
  invalid_second: bigint("invalid_second", { mode: "number" }),
})
  .withNoData()
  .as(sql`
    WITH valid_totals AS (
      SELECT
        constituency_id,
        year,
        COALESCE(SUM(CASE WHEN vote_type = 1 THEN votes ELSE 0 END), 0) AS valid_first,
        COALESCE(SUM(CASE WHEN vote_type = 2 THEN votes ELSE 0 END), 0) AS valid_second
      FROM mv_01_constituency_party_votes
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
  `);

export const seatAllocationCache = pgMaterializedView("seat_allocation_cache", {
  id: integer("id"),
  year: integer("year"),
  person_id: integer("person_id"),
  party_id: integer("party_id"),
  state_id: integer("state_id"),
  seat_type: text("seat_type"),
  constituency_name: text("constituency_name"),
  list_position: doublePrecision("list_position"),
  percent_first_votes: doublePrecision("percent_first_votes"),
  created_at: date("created_at"),
})
  .withNoData()
  .as(sql`
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
  `);
