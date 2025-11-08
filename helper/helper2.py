import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("Bundestagswahl/rawData/btw21_kandidaturen_utf9.csv") 
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)
output_filename = output_dir / "candidates.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited, ignore comment lines)
    df = pd.read_csv(input_filename, delimiter=";", comment="#", encoding="utf-8")

    # --- Separate state and wahlkreis info ---
    # Each candidate appears twice: once per 'Gebietsart' (Wahlkreis and Land)
    # We'll pivot them into one row.

    # Extract Wahlkreis info
    wahlkreis_df = df[df["Gebietsart"] == "Wahlkreis"][
        ["Nachname", "Vornamen", "Gebietsname"]
    ].rename(columns={"Gebietsname": "Wahlkreis"})

    # Extract Land (state) info
    land_df = df[df["Gebietsart"] == "Land"][
        ["Nachname", "Vornamen", "Gebietsname"]
    ].rename(columns={"Gebietsname": "State"})

    # Merge them on name (Nachname + Vornamen)
    merged = pd.merge(
        wahlkreis_df, land_df, on=["Nachname", "Vornamen"], how="outer"
    )

    # --- Base candidate info (unique per person) ---
    base_cols = [
        "Titel",
        "Namenszusatz",
        "Nachname",
        "Vornamen",
        "Künstlername",
        "Geschlecht",
        "Geburtsjahr",
        "PLZ",
        "Wohnort",
        "WohnortLandAbk",
        "Geburtsort",
        "Staatsangehörigkeit",
        "Beruf",
        "Berufsschluessel",
        "GebietLandAbk",
        "Gruppenname",
        "Listenplatz",
    ]
    base_df = df[base_cols].drop_duplicates(subset=["Nachname", "Vornamen"])

    # Merge everything
    candidates_df = pd.merge(base_df, merged, on=["Nachname", "Vornamen"], how="left")

    # Sort by Nachname
    candidates_df.sort_values(by=["Nachname", "Vornamen"], inplace=True)
    candidates_df.reset_index(drop=True, inplace=True)

    # Save the final candidate CSV
    candidates_df.to_csv(output_filename, sep=";", index=False, encoding="utf-8")

    print(f"✅ Created '{output_filename}' with {len(candidates_df)} candidates.")

except FileNotFoundError:
    print(f"❌ Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
