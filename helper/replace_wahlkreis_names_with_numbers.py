import pandas as pd
from pathlib import Path

# --- Configuration ---
input_candidates = Path("Bundestagswahl/outputs/candidates.csv")
input_wahlkreis = Path("Bundestagswahl/outputs/wahlkreis.csv")
output_candidates = Path("Bundestagswahl/outputs/candidates.csv")
# --- End of Configuration ---

try:
    # --- Load CSVs ---
    candidates_df = pd.read_csv(input_candidates, delimiter=";", encoding="utf-8")
    wahlkreis_df = pd.read_csv(input_wahlkreis, delimiter=";", encoding="utf-8")

    # --- Merge on Wahlkreis name ---
    # We'll match candidates_df["Wahlkreis"] (name) with wahlkreis_df["Gebietsname"]
    merged = pd.merge(
        candidates_df,
        wahlkreis_df[["Gebietsnummer", "Gebietsname"]],
        left_on="Wahlkreis",
        right_on="Gebietsname",
        how="left"
    )

    # Replace Wahlkreis name with the number where available
    merged["Wahlkreis"] = merged["Gebietsnummer"].combine_first(merged["Wahlkreis"])

    # Drop helper columns
    merged.drop(columns=["Gebietsnummer", "Gebietsname"], inplace=True, errors="ignore")

    # Save final CSV
    merged.to_csv(output_candidates, sep=";", index=False, encoding="utf-8")

    # --- Summary ---
    total = len(merged)
    mapped = merged["Wahlkreis"].apply(lambda x: str(x).isdigit()).sum()
    print(f"✅ Created '{output_candidates.name}' with {total} candidates.")
    print(f"   {mapped}/{total} Wahlkreis names successfully replaced with numbers.")

except FileNotFoundError as e:
    print(f"❌ Error: Missing file -> {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
