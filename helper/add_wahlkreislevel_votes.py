import pandas as pd
from pathlib import Path
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2.csv"

# Constituency mapping (has Number and ConstituencyID)
CONSTITUENCIES_2021 = DATA_DIR / "old2.0/constituencies_2021.csv"
CONSTITUENCIES_2025 = DATA_DIR / "old2.0/constituencies_2025.csv"

CONST_ELECTIONS_CSV = DATA_DIR / "constituency_elections.csv"
OUT_ENRICHED = OUTPUT_DIR / "constituency_elections_enriched.csv"
# ---------------------------------------------------------------------


def parse_num(series: pd.Series) -> pd.Series:
    """Convert German‑style numeric strings to float safely."""
    def _fix(s):
        if not isinstance(s, str):
            return s
        s = s.strip()
        if not s:
            return None
        # remove thousands separators like 12.345
        s = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", s)
        # convert decimal comma to dot
        s = s.replace(",", ".")
        return s

    return pd.to_numeric(series.map(_fix), errors="coerce")


def load_kerg(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df


def load_constituencies(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df[["Year", "Number", "ConstituencyID"]]


try:
    # ------------------------------------------------------------------
    # 1) Load base elections and attach Number via constituency mapping
    # ------------------------------------------------------------------
    print("Loading constituency mappings and elections ...")

    const21 = load_constituencies(CONSTITUENCIES_2021, 2021)
    const25 = load_constituencies(CONSTITUENCIES_2025, 2025)
    all_const = pd.concat([const21, const25], ignore_index=True)

    base = pd.read_csv(CONST_ELECTIONS_CSV, sep=";", encoding="utf-8-sig")
    base.columns = [c.strip() for c in base.columns]

    base = base.merge(
        all_const,
        on=["Year", "ConstituencyID"],
        how="left",
    )
    if base["Number"].isna().any():
        n_miss = base["Number"].isna().sum()
        print(f"Missing {n_miss} rows in constituency_elections lack a Number mapping.")

    # ------------------------------------------------------------------
    # 2) Load KERG and normalise numeric columns
    # ------------------------------------------------------------------
    print("Loading KERG files ...")
    kerg21 = load_kerg(KERG_2021, 2021)
    kerg25 = load_kerg(KERG_2025, 2025)
    kerg = pd.concat([kerg21, kerg25], ignore_index=True)

    # Only Wahlkreis rows
    wk = kerg[kerg["Gebietsart"] == "Wahlkreis"].copy()

    numeric_cols = [
        "Anzahl",
        "Prozent",
        "VorpAnzahl",
        "VorpProzent",
        "DiffProzent",
        "DiffProzentPkt",
    ]
    for col in numeric_cols:
        if col in wk.columns:
            wk[col] = parse_num(wk[col])

    # Clean Gebietsnummer into Number (int)
    wk["Number"] = (
        wk["Gebietsnummer"]
        .astype(str)
        .str.strip()
        .str.lstrip("0")
        .replace({"": None})
    )
    wk["Number"] = pd.to_numeric(wk["Number"], errors="coerce").astype("Int64")

    # Clean Stimme once (important: '1.0' -> 1, '2.0' -> 2)
    wk["StimmeClean"] = pd.to_numeric(wk["Stimme"], errors="coerce").astype("Int64")

    # ------------------------------------------------------------------
    # 3) Extract System‑Gruppe stats per (Year, Number)
    # ------------------------------------------------------------------
    sys = wk[wk["Gruppenart"] == "System-Gruppe"].copy()

    # Optional: diagnostic to confirm Ungültige/Gültige rows exist
    debug_mask = sys["Gruppenname"].isin(["Ungültige", "Gültige"])
    print(
        f"Found {debug_mask.sum()} Wahlkreis System‑Gruppe rows "
        f"with Ungültige/Gültige."
    )

    records = []
    for (year, number), g in sys.groupby(["Year", "Number"]):
        if pd.isna(number):
            continue
        row = {"Year": int(year), "Number": int(number)}

        # Eligible and total voters
        elig = g.loc[g["Gruppenname"] == "Wahlberechtigte", "Anzahl"]
        total = g.loc[g["Gruppenname"] == "Wählende", "Anzahl"]
        if not elig.empty:
            row["EligibleVoters"] = float(elig.iloc[0])
        if not total.empty:
            row["TotalVoters"] = float(total.iloc[0])
        if row.get("EligibleVoters") and row.get("TotalVoters"):
            row["Percent"] = row["TotalVoters"] / row["EligibleVoters"] * 100

        # previous‑election stats
        prev_votes = g.loc[g["Gruppenname"] == "Wahlberechtigte", "VorpAnzahl"]
        prev_pct = g.loc[g["Gruppenname"] == "Wählende", "VorpProzent"]
        diff_pct_pts = g.loc[g["Gruppenname"] == "Wählende", "DiffProzentPkt"]
        row["PrevVotes"] = float(prev_votes.iloc[0]) if not prev_votes.empty else None
        row["PrevPercent"] = float(prev_pct.iloc[0]) if not prev_pct.empty else None
        row["DiffPercentPts"] = (
            float(diff_pct_pts.iloc[0]) if not diff_pct_pts.empty else None
        )

        # Valid/Invalid counts using StimmeClean (1=Erst, 2=Zweit)
        for name, prefix in [("Ungültige", "Invalid"), ("Gültige", "Valid")]:
            for stimme_val, suffix in [(1, "First"), (2, "Second")]:
                val = g.loc[
                    (g["Gruppenname"] == name)
                    & (g["StimmeClean"] == stimme_val),
                    "Anzahl",
                ]
                row[f"{prefix}{suffix}"] = float(val.iloc[0]) if not val.empty else None

        records.append(row)

    sys_df = pd.DataFrame(records)
    print(
        f"Extracted System‑Gruppe data for {len(sys_df)} (Year, Number) pairs."
    )

    # ------------------------------------------------------------------
    # 4) Merge System‑Gruppe stats into base using (Year, Number)
    # ------------------------------------------------------------------
    enriched = base.merge(sys_df, on=["Year", "Number"], how="left")

    # Write result (keeping ConstituencyID from base)
    enriched.to_csv(OUT_ENRICHED, sep=";", index=False, encoding="utf-8-sig")
    print(f"Saved enriched file → {OUT_ENRICHED.name}")
    print(
        "Added columns: EligibleVoters, TotalVoters, Percent, "
        "PrevVotes, PrevPercent, DiffPercentPts, "
        "InvalidFirst, InvalidSecond, ValidFirst, ValidSecond (where present)"
    )
    
    
    

except Exception as e:
    print(f"Unexpected error: {type(e).__name__}: {e}")