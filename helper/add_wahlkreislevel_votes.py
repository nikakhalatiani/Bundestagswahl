import pandas as pd
from pathlib import Path

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2.csv"
CONST_ELECTIONS_CSV = OUTPUT_DIR / "constituency_elections.csv"
OUT_ENRICHED = OUTPUT_DIR / "constituency_elections_enriched.csv"
# ----------------------------------------------------------------------


def parse_num(s: pd.Series) -> pd.Series:
    """Convert German-style numeric strings to float safely."""
    return (
        s.astype(str)
        .str.replace(".", "", regex=False)
        .str.replace(",", ".", regex=False)
        .str.strip()
        .replace({"": None, "nan": None})
        .astype(float)
    )


def load_kerg(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df


try:
    # ------------------------------------------------------------------
    # 1) Load KERG and constituency_elections.csv
    # ------------------------------------------------------------------
    print("🧾 Loading files ...")
    kerg21 = load_kerg(KERG_2021, 2021)
    kerg25 = load_kerg(KERG_2025, 2025)
    kerg = pd.concat([kerg21, kerg25], ignore_index=True)

    const_elec = pd.read_csv(CONST_ELECTIONS_CSV, sep=";", encoding="utf-8-sig")
    const_elec.columns = [c.strip() for c in const_elec.columns]

    for col in ["BridgeID", "Year", "ConstituencyID"]:
        if col not in const_elec.columns:
            raise KeyError(f"{CONST_ELECTIONS_CSV.name} missing column '{col}'")

    # ------------------------------------------------------------------
    # 2) Filter and parse numeric columns from KERG
    # ------------------------------------------------------------------
    wk = kerg[kerg["Gebietsart"] == "Wahlkreis"].copy()

    for col in ["Anzahl", "VorpAnzahl", "VorpProzent", "DiffProzent", "DiffProzentPkt"]:
        if col in wk.columns:
            wk[col] = parse_num(wk[col])

    # Wahlkreis-ID join possible if you already stored ConstituencyID mapping
    if "ConstituencyID" not in wk.columns and "Gebietsnummer" in wk.columns:
        wk["ConstituencyID"] = (
            wk["Gebietsnummer"]
            .astype(str)
            .str.strip()
            .replace({"": None, "nan": None})
            .astype(float)
            .astype("Int64")
        )

    # ------------------------------------------------------------------
    # 3) Extract System-Gruppe rows with relevant stats
    # ------------------------------------------------------------------
    sys = wk[wk["Gruppenart"] == "System-Gruppe"].copy()

    records = []
    for (year, cid), g in sys.groupby(["Year", "ConstituencyID"]):
        row = {"Year": year, "ConstituencyID": cid}
        # Eligible and Total voters
        elig = g.loc[g["Gruppenname"] == "Wahlberechtigte", "Anzahl"]
        vote = g.loc[g["Gruppenname"] == "Wählende", "Anzahl"]

        row["EligibleVoters"] = float(elig.iloc[0]) if not elig.empty else None
        row["TotalVoters"] = float(vote.iloc[0]) if not vote.empty else None

        # Calculate turnout (percent)
        if row["EligibleVoters"] and row["TotalVoters"]:
            row["Percent"] = row["TotalVoters"] / row["EligibleVoters"] * 100

        # Previous data (from Vorp* columns)
        prev_votes = g.loc[g["Gruppenname"] == "Wahlberechtigte", "VorpAnzahl"]
        prev_pct = g.loc[g["Gruppenname"] == "Wählende", "VorpProzent"]
        diff_pct_pts = g.loc[g["Gruppenname"] == "Wählende", "DiffProzentPkt"]

        row["PrevVotes"] = float(prev_votes.iloc[0]) if not prev_votes.empty else None
        row["PrevPercent"] = float(prev_pct.iloc[0]) if not prev_pct.empty else None
        row["DiffPercentPts"] = (
            float(diff_pct_pts.iloc[0]) if not diff_pct_pts.empty else None
        )

        records.append(row)

    sys_df = pd.DataFrame(records)

    print(f"📊 Extracted turnout data for {len(sys_df)} constituency-year pairs")

    # ------------------------------------------------------------------
    # 4) Merge enriched stats back into constituency_elections.csv
    # ------------------------------------------------------------------
    enriched = const_elec.merge(sys_df, on=["Year", "ConstituencyID"], how="left")

    enriched.to_csv(OUT_ENRICHED, sep=";", index=False, encoding="utf-8-sig")

    print(f"💾 Saved enriched file: {OUT_ENRICHED.name}")
    print("✅ Added columns: EligibleVoters, TotalVoters, Percent, PrevVotes, PrevPercent, DiffPercentPts")

except FileNotFoundError as e:
    print(f"❌ Missing file: {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")