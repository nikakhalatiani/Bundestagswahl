import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("data/rawData/kand2021.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)
output_filename = output_dir / "state_parties.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited)
    df = pd.read_csv(input_filename, delimiter=";", encoding="utf-8")

    # --- Extract unique GebietLandAbk/Gruppenname pairs ---
    # detect party short column
    if "GruppennameKurz" in df.columns:
        party_short_col = "GruppennameKurz"
    elif "Gruppenname" in df.columns:
        party_short_col = "Gruppenname"
    else:
        raise KeyError(
            "No recognized party short-name column (GruppennameKurz or Gruppenname)")

    state_parties_df = (
        df[["GebietLandAbk", party_short_col]]
        .dropna()
        .drop_duplicates()
        .sort_values(by=["GebietLandAbk", party_short_col])
        .reset_index(drop=True)
    )

    if party_short_col != "GruppennameKurz":
        state_parties_df = state_parties_df.rename(
            columns={party_short_col: "GruppennameKurz"})

    # MANUAL FIXES
    # Brandenburg short name for Die Grünen
    # In every line with GruppennameKurz "GRÜNE/B 90", replace with "GRÜNE"
    state_parties_df.loc[
        state_parties_df["GruppennameKurz"] == "GRÜNE/B 90", "GruppennameKurz"
    ] = "GRÜNE"

    # Save output
    state_parties_df.to_csv(output_filename, sep=";",
                            index=False, encoding="utf-8")

    print(
        f"✅ Created '{output_filename.name}' with {len(state_parties_df)} unique state/party combinations.")

except FileNotFoundError:
    print(f"❌ Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
