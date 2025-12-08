import pandas as pd
from pathlib import Path
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"

# Latest KERG files (_2: party/system groups, both votes)
KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2.csv"

# Constituency mapping (internal mapping: Number <-> ConstituencyID)
CONSTITUENCIES_2021 = DATA_DIR / "old2.0/constituencies_2021.csv"
CONSTITUENCIES_2025 = DATA_DIR / "old2.0/constituencies_2025.csv"

# Base + outputs
BASE_CONST_ELEC = DATA_DIR / "constituency_elections.csv"
ENRICHED_TMP = DATA_DIR / "constituency_elections_enriched_tmp.csv"
OUT_UPDATED = DATA_DIR / "constituency_elections_updated.csv"
# ---------------------------------------------------------------------


def parse_num(series: pd.Series) -> pd.Series:
    """Convert German-style numeric strings to float safely."""
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
    # internal mapping: (Year, Number) <-> ConstituencyID
    return df[["Year", "Number", "ConstituencyID"]]


def main():
    # ------------------------------------------------------------------
    # 1) Load base elections and attach Number via constituency mapping
    # ------------------------------------------------------------------
    print("🧭 Loading constituency mappings and base elections ...")

    const21 = load_constituencies(CONSTITUENCIES_2021, 2021)
    const25 = load_constituencies(CONSTITUENCIES_2025, 2025)
    all_const = pd.concat([const21, const25], ignore_index=True)

    base = pd.read_csv(BASE_CONST_ELEC, sep=";", encoding="utf-8-sig")
    base.columns = [c.strip() for c in base.columns]

    base_with_num = base.merge(
        all_const,
        on=["Year", "ConstituencyID"],
        how="left",
    )
    if base_with_num["Number"].isna().any():
        n_miss = base_with_num["Number"].isna().sum()
        print(f"⚠ {n_miss} rows in constituency_elections lack a Number mapping.")

    # ------------------------------------------------------------------
    # 2) Load KERG and normalise numeric columns
    # ------------------------------------------------------------------
    print("🧾 Loading KERG files (including updated 2025) ...")
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
        f"📊 Extracted System‑Gruppe data for {len(sys_df)} (Year, Number) pairs."
    )

    # ------------------------------------------------------------------
    # 4) Merge System‑Gruppe stats into base using (Year, Number)
    # ------------------------------------------------------------------
    enriched = base_with_num.merge(sys_df, on=["Year", "Number"], how="left")

    # Keep a temp copy if you want to inspect the full enrichment
    enriched.to_csv(ENRICHED_TMP, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved temporary enriched file → {ENRICHED_TMP.name}")

    # ------------------------------------------------------------------
    # 5) Replace only 2025 rows in constituency_elections.csv
    # ------------------------------------------------------------------
    print("🔁 Replacing 2025 rows in constituency_elections.csv ...")

    # Reload original base (to avoid any accidental mutations)
    base_orig = pd.read_csv(BASE_CONST_ELEC, sep=";", encoding="utf-8-sig")
    base_orig.columns = [c.strip() for c in base_orig.columns]

    # Take enriched 2025 rows, drop helper 'Number' column
    new_2025 = enriched[enriched["Year"] == 2025].copy()
    if "Number" in new_2025.columns:
        new_2025 = new_2025.drop(columns=["Number"])

    # Align columns: keep exactly the columns of base_orig
    missing_cols = [c for c in base_orig.columns if c not in new_2025.columns]
    if missing_cols:
        print(f"⚠ Enriched 2025 rows missing columns {missing_cols}; "
              f"they will be filled with NA.")
        for c in missing_cols:
            new_2025[c] = None

    extra_cols = [c for c in new_2025.columns if c not in base_orig.columns]
    if extra_cols:
        new_2025 = new_2025[base_orig.columns]

    base_no_25 = base_orig[base_orig["Year"] != 2025].copy()
    updated = pd.concat([base_no_25, new_2025], ignore_index=True)

    updated.to_csv(OUT_UPDATED, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Wrote updated elections to {OUT_UPDATED.name}")
    print("👉 Inspect and, if OK, replace constituency_elections.csv with this file.")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as e:
        print(f"❌ Missing file: {e.filename}")
    except KeyError as e:
        print(f"❌ Missing expected column: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {type(e).__name__}: {e}")