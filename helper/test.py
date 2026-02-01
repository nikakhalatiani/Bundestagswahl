import pandas as pd
from pathlib import Path

DATA_DIR = Path("data")

CPV_FILE = DATA_DIR / "constituency_party_votes.csv"
CE_FILE  = DATA_DIR / "constituency_elections.csv"
DC_FILE  = DATA_DIR / "direct_candidacy.csv"
PL_FILE  = DATA_DIR / "party_lists.csv"

def load_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.replace("\ufeff", "").strip() for c in df.columns]
    return df

def main():
    # ------------------------------------------------------------------
    # 1 Direct‑candidacy (Erststimmen)
    # ------------------------------------------------------------------
    dc = load_csv(DC_FILE)
    dc = dc[dc["Erststimmen"].fillna(0) > 0]

    dc_sum = (
        dc.groupby("Year", as_index=False)
          .agg(Rows=("Erststimmen", "count"),
               SumErststimmen=("Erststimmen", "sum"))
          .set_index("Year")
    )
    print("\nDirect‑candidacy (Erststimmen)")
    print(dc_sum.to_string(float_format=lambda x: f"{x:,.0f}"))
    print()

    # ------------------------------------------------------------------
    # 2 Constituency‑party‑votes (First + Second)
    # ------------------------------------------------------------------
    ce  = load_csv(CE_FILE)
    cpv = load_csv(CPV_FILE)
    cpv = cpv.merge(ce[["BridgeID","Year"]], on="BridgeID", how="left")
    cpv = cpv[cpv["Votes"].fillna(0) > 0]

    cpv_sum = (
        cpv.groupby(["Year","VoteType"], as_index=False)
            .agg(Rows=("Votes","count"), SumVotes=("Votes","sum"))
            .pivot(index="Year", columns="VoteType")
    )
    cpv_sum.columns = [
        f"{'First' if vt==1 else 'Second'}_{col}"
        for col, vt in cpv_sum.columns
    ]
    cpv_sum = cpv_sum.fillna(0)
    print("Constituency‑party‑votes (non‑zero)")
    print(cpv_sum.to_string(float_format=lambda x: f"{x:,.0f}"))
    print()

    # ------------------------------------------------------------------
    # 3 Party‑lists (Zweitstimmen / second votes)
    # ------------------------------------------------------------------
    pl = load_csv(PL_FILE)
    pl = pl[pl["VoteCount"].fillna(0) > 0]

    pl_sum = (
        pl.groupby("Year", as_index=False)
          .agg(Rows=("VoteCount","count"),
               SumVoteCount=("VoteCount","sum"))
          .set_index("Year")
    )
    print("Party‑lists (Second‑vote totals from party_lists.csv)")
    print(pl_sum.to_string(float_format=lambda x: f"{x:,.0f}"))
    print()

    # ------------------------------------------------------------------
    # 4 Constituency‑elections official valid votes
    # ------------------------------------------------------------------
    valid = (
        ce.groupby("Year", as_index=False)[["ValidFirst","ValidSecond"]]
          .sum()
          .set_index("Year")
    )
    print("Constituency‑elections valid‑vote totals")
    print(valid.to_string(float_format=lambda x: f"{x:,.0f}"))
    print()

    # ------------------------------------------------------------------
    # 5 Combined comparison summary
    # ------------------------------------------------------------------
    print("Yearly comparison summary\n")
    combined = valid.copy()
    for vt,label in [(1,"First"),(2,"Second")]:
        combined[f"{label}_Rows"]     = cpv_sum.get(f"{label}_Rows",0).values
        combined[f"{label}_SumVotes"] = cpv_sum.get(f"{label}_SumVotes",0).values
    combined["DC_SumErststimmen"] = dc_sum.get("SumErststimmen",0).values
    combined["PL_SumVoteCount"]   = pl_sum.get("SumVoteCount",0).values

    print(combined.fillna(0).to_string(float_format=lambda x: f"{x:,.0f}"))
    print(
        "\nConsistency checks:\n"
        "  • CE.ValidFirst  ≈ CPV.First_SumVotes  ≈ DC_SumErststimmen\n"
        "  • CE.ValidSecond ≈ CPV.Second_SumVotes ≈ PL_SumVoteCount\n"
        "  All counts exclude zero‑vote entries."
    )

if __name__ == "__main__":
    main()