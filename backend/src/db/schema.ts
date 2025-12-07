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
},
  (table) => [
    unique().on(table.number, table.name),
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
  // (table) => [
  //   unique().on(table.last_name, table.first_name, table.birth_year, table.gender),
  // ]
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


export const firstVotes = pgTable("first_votes",{
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

export const secondVotes = pgTable("second_votes",{
    id: serial("id").primaryKey(),
    // each Zweitstimme is for a party list in some state
    party_list_id: integer("party_list_id")
      .notNull()
      .references(() => partyLists.id, { onDelete: "cascade" }),
    is_valid: boolean("is_valid").default(true).notNull(),
    created_at: date("created_at").defaultNow(),
  },
  // (t) => [
  //   index("second_votes_party_idx").on(t.party_list_id),
  // ]
);

// ---------- Index Helpers ---------- Later
// export const idx_constituency_state = index("constituencies_state_idx").on(
//   constituencies.state_id
// );
// export const idx_party_list_state = index("party_lists_state_idx").on(
//   partyLists.state_id
// );
// export const idx_direct_person = index("direct_cand_person_idx").on(
//   directCandidacy.person_id
// );
// export const idx_party_votes_party = index("const_party_votes_party_idx").on(
//   constituencyPartyVotes.party_id
// );

// going to sleep