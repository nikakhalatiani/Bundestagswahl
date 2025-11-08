import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("data/rawData/kand2025.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)
output_filename = output_dir / "state_parties.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited, ignore comment lines)
    df = pd.read_csv(input_filename, delimiter=";", comment="#", encoding="utf-8")

    # --- Extract unique GebietLandAbk/Gruppenname pairs ---
    state_parties_df = (
        df[["GebietLandAbk", "GruppennameKurz"]]
        .dropna()
        .drop_duplicates()
        .sort_values(by=["GebietLandAbk", "GruppennameKurz"])
        .reset_index(drop=True)
    )

    # MANUAL FIXES
    # Brandenburg short name for Die Grünen
    # In every line with GruppennameKurz "GRÜNE/B 90", replace with "GRÜNE" 
    state_parties_df.loc[
        state_parties_df["GruppennameKurz"] == "GRÜNE/B 90", "GruppennameKurz"
    ] = "GRÜNE"

    # Save output
    state_parties_df.to_csv(output_filename, sep=";", index=False, encoding="utf-8")

    print(f"✅ Created '{output_filename.name}' with {len(state_parties_df)} unique state/party combinations.")

except FileNotFoundError:
    print(f"❌ Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")