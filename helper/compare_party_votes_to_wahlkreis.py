import pandas as pd
from pathlib import Path

# --- Configuration ----------------------------------------------------
OUT_DIR = Path("data")

CPV = OUT_DIR / "constituency_party_votes.csv"
CONST_ELEC = OUT_DIR / "constituency_elections.csv"
# ---------------------------------------------------------------------


def load_csv(p: Path) -> pd.DataFrame:
    df = pd.read_csv(p, sep=";", encoding="utf-8-sig")
    df.columns = [c.replace("\ufeff", "").strip() for c in df.columns]
    return df


def main():
    cpv = load_csv(CPV)
    ce = load_csv(CONST_ELEC)

    # ---- attach Year to vote rows via BridgeID -----------------------
    cpv = cpv.merge(ce[["BridgeID", "Year"]], on="BridgeID", how="left")

    # ---- overall sums ------------------------------------------------
    first_sum = cpv.loc[cpv["VoteType"] == 1, "Votes"].sum()
    second_sum = cpv.loc[cpv["VoteType"] == 2, "Votes"].sum()

    elig_sum = ce["EligibleVoters"].sum()
    turnout_sum = ce["TotalVoters"].sum()
    turnout_pct = turnout_sum / elig_sum * 100 if elig_sum else 0

    print("📊 Overall Totals")
    print(f"  First votes total  : {first_sum:,.0f}")
    print(f"  Second votes total : {second_sum:,.0f}")
    print(f"  Eligible voters    : {elig_sum:,.0f}")
    print(f"  Votes cast (turnout): {turnout_sum:,.0f}")
    print(f"  Turnout percent    : {turnout_pct:.2f}%\n")

    # ---- per-year aggregated view -----------------------------------
    votes_by_year = (
        cpv.groupby(["Year", "VoteType"], as_index=False)["Votes"].sum()
        .pivot(index="Year", columns="VoteType", values="Votes")
        .rename(columns={1: "FirstVotes", 2: "SecondVotes"})
        .fillna(0)
    )

    # Add eligible + turnout + valid vote info
    voters_by_year = (
        ce.groupby("Year", as_index=False)[
            ["EligibleVoters", "TotalVoters", "ValidFirst", "ValidSecond"]
        ]
        .sum()
        .set_index("Year")
    )

    voters_by_year["TurnoutPercent"] = (
        voters_by_year["TotalVoters"] / voters_by_year["EligibleVoters"] * 100
    )

    # Join both summaries
    summary = votes_by_year.join(voters_by_year, how="outer").fillna(0)

    # Compare consistency
    summary["FirstDiff"] = summary["FirstVotes"] - summary["ValidFirst"]
    summary["SecondDiff"] = summary["SecondVotes"] - summary["ValidSecond"]

    print("\n📆 Yearly Summary (votes + turnout + validity checks):\n")
    print(
        summary.to_string(
            index=True,
            float_format=lambda x: f"{x:,.0f}"
            if abs(x) >= 1
            else f"{x:.2f}"
        )
    )

    print("\n✅ Differences (should be 0 if they match):")
    print(summary[["FirstDiff", "SecondDiff"]])
    
    print("\n🔎 Checking constituency-level differences for FirstVotes...\n")

    # Get yearly mismatched years dynamically
    mismatched_years = summary.loc[summary["FirstDiff"] != 0].index.tolist()

    if not mismatched_years:
        print("✅ No FirstVote mismatches detected at constituency level.")
    else:
        for year in mismatched_years:
            print(f"--- Year {year} ---")

            # Subset data for that year
            ce_year = ce.loc[ce["Year"] == year, ["BridgeID", "ValidFirst", "ValidSecond"]]
            cpv_year_first = (
                cpv.loc[(cpv["Year"] == year) & (cpv["VoteType"] == 1)]
                .groupby("BridgeID", as_index=False)["Votes"]
                .sum()
                .rename(columns={"Votes": "PartyFirstVotes"})
            )

            # Merge to compare totals
            diff_df = ce_year.merge(cpv_year_first, on="BridgeID", how="left").fillna(0)
            diff_df["FirstDiff"] = diff_df["PartyFirstVotes"] - diff_df["ValidFirst"]

            # Only keep differences
            diff_df = diff_df.loc[diff_df["FirstDiff"].round(0) != 0]

            print(diff_df.head(10).to_string(index=False))
            print(f"➡️ Found {len(diff_df)} constituencies with mismatched FirstVotes.\n")

            # Optionally save for manual fixing
            diff_path = OUT_DIR / f"firstvote_mismatches_{year}.csv"
            diff_df.to_csv(diff_path, index=False, encoding="utf-8-sig", sep=";")
            print(f"💾 Saved details to {diff_path}\n")


if __name__ == "__main__":
    main()