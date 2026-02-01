import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("data/rawData/kand2021.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)

parties_filename = output_dir / "parties.csv"
states_filename = output_dir / "states.csv"
wahlkreis_filename = output_dir / "wahlkreis.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited)
    df = pd.read_csv(input_filename, delimiter=";", encoding="utf-8")

    # --- Parties CSV ---
    # detect party columns for 2025 vs 2021 formats
    if "GruppennameKurz" in df.columns and "Gruppenname" in df.columns:
        short_col = "GruppennameKurz"
        long_col = "Gruppenname"
    elif "Gruppenname" in df.columns and "GruppennameLang" in df.columns:
        # 2021: Gruppenname (short), GruppennameLang (long)
        short_col = "Gruppenname"
        long_col = "GruppennameLang"
    else:
        raise KeyError("No recognized party name columns (expected GruppennameKurz+Gruppenname or Gruppenname+GruppennameLang)")

    parties_df = (
        df[[short_col, long_col]]
        .dropna(subset=[short_col])
        .drop_duplicates()
        .sort_values(by=[short_col])
    )

    # Normalize output column names to (short,long) => (GruppennameKurz,Gruppenname)
    parties_df = parties_df.rename(columns={short_col: "GruppennameKurz", long_col: "Gruppenname"})
    parties_df.to_csv(parties_filename, sep=";", index=False, encoding="utf-8")

    # --- States CSV (only Gebietsart == 'Land') ---
    states_df = (
        df[df["Gebietsart"] == "Land"][["GebietLandAbk", "Gebietsname"]]
        .dropna()
        .drop_duplicates()
        .sort_values(by=["GebietLandAbk"])
    )
    states_df.to_csv(states_filename, sep=";", index=False, encoding="utf-8")

    # --- Wahlkreis CSV (only Gebietsart == 'Wahlkreis') ---
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
    print("CSVs successfully created:")
    print(f"   • Parties: {len(parties_df)} entries -> {parties_filename.name}")
    print(f"   • States: {len(states_df)} entries -> {states_filename.name}")
    print(f"   • Wahlkreis: {len(wahlkreis_df)} entries -> {wahlkreis_filename.name}")

except FileNotFoundError:
    print(f"Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"Missing expected column: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")
