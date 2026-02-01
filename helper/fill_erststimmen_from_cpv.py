import pandas as pd
from pathlib import Path

DATA_DIR = Path("data")

DIRECT_IN = DATA_DIR / "direct_candidacy_updated.csv"   # from kand rebuild
DIRECT_OUT = DATA_DIR / "direct_candidacy_updated_with_votes.csv"

CPV_FILE = DATA_DIR / "constituency_party_votes.csv"
CE_FILE = DATA_DIR / "constituency_elections.csv"


def load_csv(p: Path) -> pd.DataFrame:
    df = pd.read_csv(p, sep=";", encoding="utf-8-sig")
    df.columns = [c.replace("\ufeff", "").strip() for c in df.columns]
    return df


def main():
    print("Loading files ...")
    dc = load_csv(DIRECT_IN)
    cpv = load_csv(CPV_FILE)
    ce = load_csv(CE_FILE)

    # Make sure numeric types are comparable
    dc["Year"] = pd.to_numeric(dc["Year"], errors="coerce").astype("Int64")
    dc["ConstituencyID"] = pd.to_numeric(
        dc["ConstituencyID"], errors="coerce"
    ).astype("Int64")
    dc["PartyID"] = pd.to_numeric(dc["PartyID"], errors="coerce").astype("Int64")

    cpv["PartyID"] = pd.to_numeric(cpv["PartyID"], errors="coerce").astype("Int64")
    cpv["VoteType"] = pd.to_numeric(cpv["VoteType"], errors="coerce").astype("Int64")
    cpv["Votes"] = pd.to_numeric(cpv["Votes"], errors="coerce")

    # Attach Year + ConstituencyID to CPV via BridgeID
    bridge = ce[["BridgeID", "Year", "ConstituencyID"]].copy()
    bridge["Year"] = pd.to_numeric(bridge["Year"], errors="coerce").astype("Int64")
    bridge["ConstituencyID"] = pd.to_numeric(
        bridge["ConstituencyID"], errors="coerce"
    ).astype("Int64")

    cpv = cpv.merge(bridge, on="BridgeID", how="left")

    # Aggregate first votes in CPV to (Year, ConstituencyID, PartyID)
    cpv_first = cpv[cpv["VoteType"] == 1].copy()
    cpv_first = cpv_first[cpv_first["Votes"].fillna(0) > 0]

    cpv_first_agg = (
        cpv_first.groupby(["Year", "ConstituencyID", "PartyID"], as_index=False)[
            "Votes"
        ]
        .sum()
        .rename(columns={"Votes": "Erststimmen_new"})
    )

    # Merge onto direct candidacy rows
    out = dc.merge(
        cpv_first_agg,
        on=["Year", "ConstituencyID", "PartyID"],
        how="left",
    )

    # Replace / fill Erststimmen
    out["Erststimmen"] = out["Erststimmen_new"].combine_first(out["Erststimmen"])
    out = out.drop(columns=["Erststimmen_new"])

    # Report unmatched rows (no vote found)
    unmatched = out[out["Erststimmen"].isna()][
        ["PersonID", "Year", "ConstituencyID", "PartyID"]
    ].copy()

    print("\nFill results")
    print(f"  total direct rows        : {len(out):,}")
    print(f"  filled Erststimmen rows  : {out['Erststimmen'].notna().sum():,}")
    print(f"  missing Erststimmen rows : {len(unmatched):,}")

    if len(unmatched):
        print("\nUnmatched examples (likely PartyID mapping issues):")
        print(unmatched.head(25).to_string(index=False))

        # helpful file for manual review
        unmatched_path = DATA_DIR / "direct_candidacy_unmatched_votes.csv"
        unmatched.to_csv(unmatched_path, sep=";", index=False, encoding="utf-8-sig")
        print(f"\nWrote unmatched list → {unmatched_path}")

    # Totals by year
    totals = (
        out.dropna(subset=["Erststimmen"])
        .groupby("Year", as_index=False)["Erststimmen"]
        .sum()
    )
    print("\nTotal Erststimmen by year (from direct_candidacy):")
    print(totals.to_string(index=False, float_format=lambda x: f"{x:,.0f}"))

    # Save final
    out.to_csv(DIRECT_OUT, sep=";", index=False, encoding="utf-8-sig")
    print(f"\nSaved → {DIRECT_OUT}")


if __name__ == "__main__":
    main()