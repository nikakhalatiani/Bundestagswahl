import pandas as pd
from pathlib import Path

# --- Configuration ---
input_results = Path("data/rawData/kerg2025_2.csv")
input_candidates = Path("Bundestagswahl/outputs/candidates.csv")
input_wahlkreis = Path("Bundestagswahl/outputs/wahlkreis.csv")
output_candidates = Path("Bundestagswahl/outputs/candidates.csv")
# --- End of Configuration ---

try:
    # --- Load CSVs ---
    results_df = pd.read_csv(input_results, delimiter=";", encoding="utf-8")
    candidates_df = pd.read_csv(input_candidates, delimiter=";", encoding="utf-8")
    wahlkreis_df = pd.read_csv(input_wahlkreis, delimiter=";", encoding="utf-8")
    
    # --- Filter for Wahlkreis-level results (Stimme 1 = Erststimme) ---
    wahlkreis_results = results_df[
        (results_df["Gebietsart"] == "Wahlkreis") & 
        (results_df["Stimme"] == 1)
    ].copy()
    
    print(f"📊 Found {len(wahlkreis_results)} Wahlkreis-level results")
    
    # --- Create mapping from Gebietsnummer to Gebietsname ---
    wahlkreis_map = dict(zip(wahlkreis_df["Gebietsnummer"], wahlkreis_df["Gebietsname"]))
    
    # --- Prepare candidates: convert Wahlkreis to int (handling NaN) ---
    # First, fill NaN with -1, then convert to int
    candidates_df["Wahlkreis_int"] = candidates_df["Wahlkreis"].fillna(-1).astype(int)
    
    # --- Merge results with candidates ---
    # Match on: Wahlkreis (as Gebietsnummer) and GruppennameKurz (party)
    merged = pd.merge(
        candidates_df,
        wahlkreis_results[["Gebietsnummer", "Gruppenname", "Anzahl"]],
        left_on=["Wahlkreis_int", "GruppennameKurz"],
        right_on=["Gebietsnummer", "Gruppenname"],
        how="left"
    )
    
    # --- Clean up: remove helper columns and rename Anzahl ---
    merged.drop(columns=["Gebietsnummer", "Gruppenname", "Wahlkreis_int"], inplace=True, errors="ignore")
    merged.rename(columns={"Anzahl": "Erststimmen"}, inplace=True)
    
    # --- Save output ---
    merged.to_csv(output_candidates, sep=";", index=False, encoding="utf-8")
    
    # --- Summary ---
    total = len(merged)
    with_votes = merged["Erststimmen"].notna().sum()
    total_votes = merged["Erststimmen"].sum()
    
    print(f"✅ Created '{output_candidates.name}' with {total} candidates.")
    print(f"   {with_votes}/{total} candidates matched with vote counts.")
    print(f"   Total Erststimmen counted: {int(total_votes):,}")

except FileNotFoundError as e:
    print(f"❌ Error: Missing file -> {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
