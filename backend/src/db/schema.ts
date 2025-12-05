import {
  pgTable,
  varchar,
  integer,
  serial,
  doublePrecision,
  text,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// ---------- State ----------
export const states = pgTable("states", {
  id: varchar("id", { length: 5 }).primaryKey(), // e.g. "BB", "BE"
  name: varchar("name", { length: 100 }).notNull(),
});

// ---------- Party ----------
export const parties = pgTable("parties", {
  // Use the party short name as the primary key (e.g. "SPD", "CDU").
  short_name: varchar("short_name", { length: 120 }).primaryKey().notNull(),
  long_name: varchar("long_name", { length: 200 }).notNull(),
});

// ---------- Constituency ----------
export const constituencies = pgTable("constituencies", {
  number: integer("number").primaryKey(),
  name: varchar("name", { length: 150 }).notNull(),
  state_id: varchar("state_id", { length: 5 })
    .notNull()
    .references(() => states.id, { onDelete: "restrict", onUpdate: "cascade" }),
});

// ---------- Candidate ----------
export const candidates = pgTable("candidates", {
  id: serial("id").primaryKey(),
  title: text("title"),
  name_addition: text("name_addition"),
  last_name: text("last_name").notNull(),
  first_name: text("first_name").notNull(),
  artist_name: text("artist_name"),
  gender: text("gender"),
  birth_year: integer("birth_year"),
  postal_code: text("postal_code"),
  city: text("city"),
  city_state_abbr: text("city_state_abbr"),
  birth_place: text("birth_place"),
  profession: text("profession"),
  state_id: varchar("state_id", { length: 5 })
    .notNull()
    .references(() => states.id, { onDelete: "restrict", onUpdate: "cascade" }),
  party_short_name: varchar("party_short_name", { length: 120 }).references(
    () => parties.short_name,
    { onDelete: "set null", onUpdate: "cascade" }
  ),
  list_position: doublePrecision("list_position"),
  constituency_num: integer("constituency_num").references(
    () => constituencies.number,
    { onDelete: "set null", onUpdate: "cascade" }
  ),
  state_name: text("state_name"),
  first_votes: doublePrecision("first_votes"),
});

// ---------- StateParty ----------
export const stateParties = pgTable(
  "state_parties",
  {
    state_id: varchar("state_id", { length: 5 })
      .notNull()
      .references(() => states.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    party_short_name: varchar("party_short_name", { length: 120 })
      .notNull()
      .references(() => parties.short_name, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    second_votes: doublePrecision("second_votes").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.state_id, table.party_short_name],
      name: "state_parties_state_id_party_short_name_pk",
    }),
  ]
);


// ---------- Ballot ----------
export const ballots = pgTable(
  "ballots",
  {
    id: serial("id").primaryKey(),
    constituency_num: integer("constituency_num")
      .notNull()
      .references(() => constituencies.number, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    voter_id: integer("voter_id").notNull(),
    first_vote_candidate_id: integer("first_vote_candidate_id").references(
      () => candidates.id,
      { onDelete: "set null", onUpdate: "cascade" }
    ),
    second_vote_party: varchar("second_vote_party", { length: 120 }),
    is_first_vote_valid: boolean("is_first_vote_valid").default(true).notNull(),
    is_second_vote_valid: boolean("is_second_vote_valid").default(true).notNull(),
    created_at: timestamp("created_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ballots_constituency_num_idx").on(table.constituency_num),
    index("ballots_first_vote_candidate_id_idx").on(table.first_vote_candidate_id),
    index("ballots_second_vote_party_idx").on(table.second_vote_party),
  ]
);