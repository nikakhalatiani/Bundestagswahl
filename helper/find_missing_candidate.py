import pandas as pd
from pathlib import Path
import unicodedata
import re

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# CSV files
csv_small = DATA_DIR / "candidates2025.csv"   # the smaller CSV (fewer rows)
csv_large = DATA_DIR / "rawData/kand2025.csv"      # the larger CSV (potentially more rows)

out_not_in_small = OUTPUT_DIR / "missing_in_subset.csv"



# ----------------------------------------------------------------------
# Helper functions
# ----------------------------------------------------------------------
def norm(s: str) -> str:
    """Normalize and lowercase text for reliable matching."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()



# ----------------------------------------------------------------------
# Main comparison logic
# ----------------------------------------------------------------------
try:
    # --- Load both CSVs -------------------------------------------------
    print("Reading CSV files ...")
    df_small = pd.read_csv(csv_small, sep=";", encoding="utf-8-sig")
    df_large = pd.read_csv(csv_large, sep=";", encoding="utf-8-sig")

    # Normalize column names
    df_small.columns = [c.strip() for c in df_small.columns]
    df_large.columns = [c.strip() for c in df_large.columns]

    # --- Verify presence of necessary key columns ----------------------
    key_fields = ["Nachname", "Vornamen", "Geschlecht", "Geburtsjahr", "Geburtsort"]
    missing_small = [c for c in key_fields if c not in df_small.columns]
    missing_large = [c for c in key_fields if c not in df_large.columns]

    if missing_small:
        raise KeyError(f"Small CSV is missing columns: {missing_small}")
    if missing_large:
        raise KeyError(f"Large CSV is missing columns: {missing_large}")

    # --- Build composite keys ------------------------------------------
    for df in (df_small, df_large):
        df["key"] = (
            df["Nachname"].map(norm)
            + "|" + df["Vornamen"].map(norm)
            + "|" + df["Geschlecht"].map(norm)
            # + "|" + df["Geburtsjahr"].fillna("").astype(str).str.strip()
            # + "|" + df["Geburtsort"].map(norm)
        )

    # --- Detect which keys are missing ---------------------------------
    print("Comparing composite keys ...")
    small_keys = set(df_small["key"].unique())
    df_missing = df_large[~df_large["key"].isin(small_keys)].copy()

    # Optional deduplication on the missing side
    df_missing = df_missing.drop_duplicates(subset=["key"])

    # --- Output ---------------------------------------------------------
    df_missing.to_csv(out_not_in_small, index=False, sep=";", encoding="utf-8-sig")
    print(
        f"\nFound {len(df_missing)} rows in the larger CSV "
        f"that are not present in the smaller CSV."
    )
    print(f"Saved results to: {out_not_in_small}")

except FileNotFoundError as e:
    print(f"Missing file: {e.filename}")
except KeyError as e:
    print(f"Missing column: {e}")
except Exception as e:
    print(f"Unexpected error: {type(e).__name__}: {e}")