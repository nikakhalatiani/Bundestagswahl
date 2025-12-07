import pandas as pd
from pathlib import Path

# --- Configuration ----------------------------------------------------
OUTPUT_DIR = Path("data")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PARTY_LISTS_CSV = OUTPUT_DIR / "party_lists.csv"
CPV_CSV = OUTPUT_DIR / "constituency_party_votes.csv"
CONST_ELEC_CSV = OUTPUT_DIR / "constituency_elections.csv"
CONSTITUENCIES_CSV = OUTPUT_DIR / "constituencies.csv"
PARTIES_CSV = OUTPUT_DIR / "parties.csv"

OUT_PARTY_LISTS = OUTPUT_DIR / "party_lists_updated.csv"
OUT_AGG_STATE_PARTY = OUTPUT_DIR / "state_party_votes_from_constituencies.csv"
# ---------------------------------------------------------------------


def load_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    # Strip BOM and whitespace from column names
    df.columns = [c.replace("\ufeff", "").strip() for c in df.columns]
    return df


try:
    # ------------------------------------------------------------------
    # 1. Load all relevant CSVs
    # ------------------------------------------------------------------
    print("🧭 Loading CSV files ...")
    party_lists = load_csv(PARTY_LISTS_CSV)
    cpv = load_csv(CPV_CSV)
    const_elec = load_csv(CONST_ELEC_CSV)
    constituencies = load_csv(CONSTITUENCIES_CSV)
    parties = load_csv(PARTIES_CSV)

    print(f"  party_lists rows          : {len(party_lists)}")
    print(f"  constituency_party_votes  : {len(cpv)}")
    print(f"  constituency_elections    : {len(const_elec)}")
    print(f"  constituencies            : {len(constituencies)}")
    print(f"  parties                   : {len(parties)}")

    # Basic column checks
    required_pl = ["PartyListID", "Year", "StateID", "PartyID", "VoteCount"]
    missing_pl = [c for c in required_pl if c not in party_lists.columns]
    if missing_pl:
        raise KeyError(f"party_lists.csv missing columns: {missing_pl}")

    required_cpv = ["BridgeID", "PartyID", "VoteType", "Votes"]
    missing_cpv = [c for c in required_cpv if c not in cpv.columns]
    if missing_cpv:
        raise KeyError(f"constituency_party_votes.csv missing columns: {missing_cpv}")

    required_ce = ["BridgeID", "Year", "ConstituencyID"]
    missing_ce = [c for c in required_ce if c not in const_elec.columns]
    if missing_ce:
        raise KeyError(f"constituency_elections.csv missing columns: {missing_ce}")

    required_const = ["ConstituencyID", "StateID"]
    missing_const = [c for c in required_const if c not in constituencies.columns]
    if missing_const:
        raise KeyError(f"constituencies.csv missing columns: {missing_const}")

    # ------------------------------------------------------------------
    # 2. Aggregate second votes by (Year, StateID, PartyID)
    # ------------------------------------------------------------------
    print("\n🔢 Aggregating Zweitstimmen from constituency_party_votes ...")

    # Only second votes (VoteType = 2)
    cpv_2 = cpv[cpv["VoteType"] == 2].copy()

    # Attach Year & ConstituencyID via BridgeID
    cpv_2 = cpv_2.merge(
        const_elec[["BridgeID", "Year", "ConstituencyID"]],
        on="BridgeID",
        how="left",
    )

    # Attach StateID via ConstituencyID
    cpv_2 = cpv_2.merge(
        constituencies[["ConstituencyID", "StateID"]],
        on="ConstituencyID",
        how="left",
    )

    if cpv_2["StateID"].isna().any():
        n_missing_state = cpv_2["StateID"].isna().sum()
        print(f"⚠ Warning: {n_missing_state} cpv rows missing StateID after join.")

    # Group by Year, StateID, PartyID
    agg = (
        cpv_2.groupby(["Year", "StateID", "PartyID"], as_index=False)["Votes"]
        .sum()
        .rename(columns={"Votes": "NewVoteCount"})
    )

    print(f"  Aggregated into {len(agg)} (Year, StateID, PartyID) rows.")

    # Optional: add party names for inspection
    if {"PartyID", "ShortName", "LongName"}.issubset(parties.columns):
        agg_named = agg.merge(
            parties[["PartyID", "ShortName", "LongName"]],
            on="PartyID",
            how="left",
        )
    else:
        agg_named = agg.copy()

    agg_named.to_csv(OUT_AGG_STATE_PARTY, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved intermediate state/party aggregates to {OUT_AGG_STATE_PARTY.name}")

    # ------------------------------------------------------------------
    # 3. Update VoteCount in party_lists from aggregated values
    # ------------------------------------------------------------------
    print("\n🧮 Updating party_lists VoteCount from aggregates ...")

    pl_merged = party_lists.merge(
        agg[["Year", "StateID", "PartyID", "NewVoteCount"]],
        on=["Year", "StateID", "PartyID"],
        how="left",
    )

    # How many rows will be updated?
    n_match = pl_merged["NewVoteCount"].notna().sum()
    print(f"  Found matching aggregates for {n_match}/{len(pl_merged)} party_list rows.")

    # Replace VoteCount where we have a new value
    pl_merged["VoteCount"] = pl_merged["NewVoteCount"].fillna(pl_merged["VoteCount"])
    pl_merged.drop(columns=["NewVoteCount"], inplace=True)

    pl_merged.to_csv(OUT_PARTY_LISTS, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved updated party_lists to {OUT_PARTY_LISTS.name}")

    print("\n🎉 Done.\n")

except FileNotFoundError as e:
    print(f"❌ Missing file: {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")