import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("Bundestagswahl/rawData/kand2025.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)

parties_filename = output_dir / "parties.csv"
states_filename = output_dir / "states.csv"
wahlkreis_filename = output_dir / "wahlkreis.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited, ignore comment lines)
    df = pd.read_csv(input_filename, delimiter=";", comment="#", encoding="utf-8")

    # --- 1️⃣ Parties CSV ---
    parties_df = (
        df[["GruppennameKurz", "Gruppenname"]]
        .dropna(subset=["GruppennameKurz"])
        .drop_duplicates()
        .sort_values(by=["GruppennameKurz"])
    )
    parties_df.to_csv(parties_filename, sep=";", index=False, encoding="utf-8")

    # --- 2️⃣ States CSV (only Gebietsart == 'Land') ---
    states_df = (
        df[df["Gebietsart"] == "Land"][["GebietLandAbk", "Gebietsname"]]
        .dropna()
        .drop_duplicates()
        .sort_values(by=["GebietLandAbk"])
    )
    states_df.to_csv(states_filename, sep=";", index=False, encoding="utf-8")

    # --- 3️⃣ Wahlkreis CSV (only Gebietsart == 'Wahlkreis') ---
    wahlkreis_df = (
        df[df["Gebietsart"] == "Wahlkreis"][
            ["Gebietsnummer", "Gebietsname", "GebietLandAbk"]
        ]
        .dropna(subset=["Gebietsnummer"])
        .drop_duplicates()
        .sort_values(by=["Gebietsnummer"])
    )
    wahlkreis_df.to_csv(wahlkreis_filename, sep=";", index=False, encoding="utf-8")

    # --- Summary ---
    print("✅ CSVs successfully created:")
    print(f"   • Parties: {len(parties_df)} entries -> {parties_filename.name}")
    print(f"   • States: {len(states_df)} entries -> {states_filename.name}")
    print(f"   • Wahlkreis: {len(wahlkreis_df)} entries -> {wahlkreis_filename.name}")

except FileNotFoundError:
    print(f"❌ Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
