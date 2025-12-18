import pandas as pd
from pathlib import Path

# --- Configuration ----------------------------------------------------
DATA = Path("data")

CPV_CSV        = DATA / "constituency_party_votes.csv"
CONST_ELEC_CSV = DATA / "constituency_elections.csv"
CONSTITUENCIES = DATA / "constituencies.csv"
PARTY_LISTS_OUT = DATA / "party_lists_rebuilt.csv"
# ---------------------------------------------------------------------

def load_csv(p: Path) -> pd.DataFrame:
    df = pd.read_csv(p, sep=";", encoding="utf-8-sig")
    df.columns = [c.replace("\ufeff", "").strip() for c in df.columns]
    return df

def main():
    print("🧭 Loading inputs …")
    cpv          = load_csv(CPV_CSV)
    const_elec   = load_csv(CONST_ELEC_CSV)
    constituencies = load_csv(CONSTITUENCIES)

    # --------------------------------------------------------------
    # 1️⃣ prepare second‑vote subset (VoteType == 2)
    # --------------------------------------------------------------
    print("\n🔢 Aggregating Zweitstimmen from constituency_party_votes …")
    cpv_2 = cpv[cpv["VoteType"] == 2].copy()

    # attach Year and ConstituencyID
    cpv_2 = cpv_2.merge(
        const_elec[["BridgeID", "Year", "ConstituencyID"]],
        on="BridgeID", how="left"
    )

    # attach StateID
    cpv_2 = cpv_2.merge(
        constituencies[["ConstituencyID","StateID"]],
        on="ConstituencyID", how="left"
    )

    if cpv_2["StateID"].isna().any():
        miss = int(cpv_2["StateID"].isna().sum())
        print(f"⚠️ {miss} rows missing StateID after join.")

    # --------------------------------------------------------------
    # 2️⃣ aggregate votes by (Year, StateID, PartyID)
    # --------------------------------------------------------------
    agg = (
        cpv_2.groupby(["Year","StateID","PartyID"], as_index=False)["Votes"]
        .sum()
        .rename(columns={"Votes":"VoteCount"})
    )

    # --------------------------------------------------------------
    # 3️⃣ assign sequential PartyListID values
    # --------------------------------------------------------------
    agg = agg.sort_values(["Year","StateID","PartyID"]).reset_index(drop=True)
    agg.insert(0,"PartyListID", range(1,len(agg)+1))

    # --------------------------------------------------------------
    # 4️⃣ store rebuilt file
    # --------------------------------------------------------------
    agg.to_csv(PARTY_LISTS_OUT, sep=";", index=False, encoding="utf-8-sig")
    totals = agg.groupby("Year")["VoteCount"].sum()

    print(f"\n💾 Saved → {PARTY_LISTS_OUT.name}")
    print("📊 Totals by year:")
    for y,v in totals.items():
        print(f"  {int(y)} → {v:,.0f}")

    print("\n✅ Output columns:")
    print(";".join(agg.columns))
    print("\n🎉 Done – new party_lists CSV ready.")

if __name__ == "__main__":
    main()