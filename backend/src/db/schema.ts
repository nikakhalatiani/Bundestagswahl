import {
  pgTable,
  serial,
  integer,
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
  foreigner_pct: doublePrecision("foreigner_pct"),
  disposable_income: doublePrecision("disposable_income"),
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
  vote_count: doublePrecision("vote_count").notNull(),
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
  first_votes: doublePrecision("first_votes"),
  previously_elected: boolean("previously_elected").default(false).notNull(),
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
  previously_elected: boolean("previously_elected").default(false).notNull(),
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
  total_voters: doublePrecision("total_voters"),
  percent: doublePrecision("percent"),
  prev_votes: doublePrecision("prev_votes"),
  prev_percent: doublePrecision("prev_percent"),
  diff_percent_pts: doublePrecision("diff_percent_pts"),
  invalid_first: doublePrecision("invalid_first"),
  invalid_second: doublePrecision("invalid_second"),
  valid_first: doublePrecision("valid_first"),
  valid_second: doublePrecision("valid_second"),
},
  (table) => [
    unique().on(table.constituency_id, table.year),
  ]);

// ---------- Constituency / Party Votes ----------
export const constituencyPartyVotes = pgTable("constituency_party_votes", {
  id: serial("id").primaryKey(),     // ID
  bridge_id: integer("bridge_id")
    .notNull()
    .references(() => constituencyElections.bridge_id, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
  vote_type: integer("vote_type").notNull(),  // 1 = Erst, 2 = Zweit
  votes: doublePrecision("votes"),
  percent: doublePrecision("percent"),
  prev_votes: doublePrecision("prev_votes"),
  prev_percent: doublePrecision("prev_percent"),
  diff_percent_pts: doublePrecision("diff_percent_pts"),
},
  (table) => [
    unique().on(table.party_id, table.bridge_id, table.vote_type),
  ]
);


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
  is_valid: boolean("is_valid").default(true).notNull(),
  created_at: date("created_at").defaultNow(),
},
  (t) => [
    index("second_votes_party_idx").on(t.party_list_id),
  ]
);

// ---------- Cache Tables for Seat Allocation Results ----------

// Cache for seat allocation results (630 seats per year)
export const seatAllocationCache = pgTable("seat_allocation_cache", {
  id: serial("id").primaryKey(),
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  person_id: integer("person_id")
    .notNull()
    .references(() => persons.id, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
  state_id: integer("state_id")
    .notNull()
    .references(() => states.id, { onDelete: "cascade" }),
  seat_type: varchar("seat_type", { length: 50 }).notNull(),
  constituency_name: varchar("constituency_name", { length: 150 }),
  list_position: doublePrecision("list_position"),
  percent_first_votes: doublePrecision("percent_first_votes"),
  created_at: date("created_at").defaultNow(),
},
  (table) => [
    unique().on(table.year, table.person_id),
    index("idx_seat_cache_year").on(table.year),
    index("idx_seat_cache_party").on(table.party_id, table.year),
    index("idx_seat_cache_state").on(table.state_id, table.year),
    index("idx_seat_cache_type").on(table.seat_type, table.year),
  ]
);

// Cache for party summary (10-15 rows per year)
export const partySummaryCache = pgTable("party_summary_cache", {
  id: serial("id").primaryKey(),
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
  second_votes: doublePrecision("second_votes").notNull(),
  percent_second_votes: doublePrecision("percent_second_votes").notNull(),
  direct_mandates: integer("direct_mandates").notNull().default(0),
  minority_party: boolean("minority_party").notNull().default(false),
  in_bundestag: boolean("in_bundestag").notNull().default(false),
  created_at: date("created_at").defaultNow(),
},
  (table) => [
    unique().on(table.year, table.party_id),
    index("idx_party_summary_year").on(table.year),
    index("idx_party_summary_bundestag").on(table.year, table.in_bundestag),
  ]
);

// Cache for federal distribution (10-15 rows per year)
export const federalDistributionCache = pgTable("federal_distribution_cache", {
  id: serial("id").primaryKey(),
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
  seats: integer("seats").notNull(),
  created_at: date("created_at").defaultNow(),
},
  (table) => [
    unique().on(table.year, table.party_id),
    index("idx_federal_dist_year").on(table.year),
  ]
);

// Cache for state distribution (150-200 rows per year)
export const stateDistributionCache = pgTable("state_distribution_cache", {
  id: serial("id").primaryKey(),
  year: integer("year")
    .notNull()
    .references(() => elections.year, { onDelete: "cascade" }),
  party_id: integer("party_id")
    .notNull()
    .references(() => parties.id, { onDelete: "cascade" }),
  state_id: integer("state_id")
    .notNull()
    .references(() => states.id, { onDelete: "cascade" }),
  seats: integer("seats").notNull(),
  created_at: date("created_at").defaultNow(),
},
  (table) => [
    unique().on(table.year, table.party_id, table.state_id),
    index("idx_state_dist_year").on(table.year),
    index("idx_state_dist_party").on(table.party_id, table.year),
    index("idx_state_dist_state").on(table.state_id, table.year),
  ]
);
