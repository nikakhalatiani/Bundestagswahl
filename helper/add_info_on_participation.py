import pandas as pd
from pathlib import Path
import unicodedata
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data/rawData")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Official candidate sources with VorpGewaehlt
KAND_FILES = [
    DATA_DIR / "kand2021.csv",
    DATA_DIR / "kand2025.csv",
]

# Existing normalized tables
PERSONS_CSV = OUTPUT_DIR / "persons.csv"
DIRECT_CANDIDACY = OUTPUT_DIR / "direct_candidacy.csv"
PARTY_LIST_CANDIDACY = OUTPUT_DIR / "party_list_candidacy.csv"

OUT_DIRECT = OUTPUT_DIR / "direct_candidacy_with_prev.csv"
OUT_LIST = OUTPUT_DIR / "party_list_candidacy_with_prev.csv"
# ---------------------------------------------------------------------


def norm(s: str) -> str:
    """Lowercase, normalized text for comparisons."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


def build_person_key(df: pd.DataFrame) -> pd.Series:
    """Composite person key: Nachname|Vornamen|Geschlecht|Geburtsjahr."""
    return (
        df["Nachname"].map(norm)
        + "|" + df["Vornamen"].map(norm)
        + "|" + df["Geschlecht"].map(norm)
        + "|" + df["Geburtsjahr"].fillna("").astype(str).str.strip()
    )


try:
    # -----------------------------------------------------------------
    # 1) Build lookup (person key → VorpGewaehlt per year)
    # -----------------------------------------------------------------
    all_flags = []

    for path in KAND_FILES:
        year = int(re.search(r"\d{4}", path.stem).group())
        print(f"🗂 Reading {path.name} for {year} ...")
        if not path.exists():
            print(f"⚠ Missing file {path}, skipping.")
            continue

        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip() for c in df.columns]

        if "VorpGewaehlt" not in df.columns:
            print(f"⚠ {path.name} lacks 'VorpGewaehlt' column - skipping.")
            continue

        required = ["Nachname", "Vornamen", "Geschlecht", "Geburtsjahr"]
        if not all(c in df.columns for c in required):
            print(f"⚠ {path.name} is missing some of {required} - skipping.")
            continue

        df["key"] = build_person_key(df)
        df["PreviouslyElected"] = (
            df["VorpGewaehlt"].astype(str).str.strip().str.upper() == "X"
        )

        sub = df[["Year", "key", "PreviouslyElected"]].copy() if "Year" in df.columns else df[["key", "PreviouslyElected"]].copy()
        sub["Year"] = year
        all_flags.append(sub)

    if not all_flags:
        raise ValueError("No kand files with VorpGewaehlt data.")

    flag_df = pd.concat(all_flags, ignore_index=True).drop_duplicates(subset=["Year", "key"])
    print(f"✅ Built lookup for {len(flag_df)} person–year rows from kand data.")

    # -----------------------------------------------------------------
    # 2) Prepare persons master (for name/gender/year mapping)
    # -----------------------------------------------------------------
    persons = pd.read_csv(PERSONS_CSV, sep=";", encoding="utf-8-sig")
    persons.columns = [c.strip() for c in persons.columns]
    persons["key"] = build_person_key(persons)[persons.index]

    reduced_persons = persons[["PersonID", "key"]].copy()

    # -----------------------------------------------------------------
    # 3) Helper function to enrich a candidacy file
    # -----------------------------------------------------------------
    def enrich_candidacy(label: str, infile: Path, outfile: Path):
        print(f"\n🧭 Enriching {label} ...")

        if not infile.exists():
            print(f"⚠ Missing {infile}, skipping this file.")
            return

        cand = pd.read_csv(infile, sep=";", encoding="utf-8-sig")
        if "PersonID" not in cand.columns or "Year" not in cand.columns:
            print(f"⚠ {infile.name} missing required columns PersonID/Year - skipping.")
            return

        # Attach person key
        cand = cand.merge(reduced_persons, on="PersonID", how="left")
        # Attach PreviouslyElected bool
        cand = cand.merge(flag_df, on=["Year", "key"], how="left")
        cand["PreviouslyElected"] = cand["PreviouslyElected"].fillna(False)
        cand.drop(columns=["key"], inplace=True)

        cand.to_csv(outfile, sep=";", index=False, encoding="utf-8-sig")
        n_true = cand["PreviouslyElected"].sum()
        print(f"💾 Saved {outfile.name}   {n_true} incumbents marked TRUE")

    # -----------------------------------------------------------------
    # 4) Apply enrichment to both direct and party‑list
    # -----------------------------------------------------------------
    enrich_candidacy("Direct candidacies", DIRECT_CANDIDACY, OUT_DIRECT)
    enrich_candidacy("Party list candidacies", PARTY_LIST_CANDIDACY, OUT_LIST)

    print("\n🎉 Done.\n")

except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")