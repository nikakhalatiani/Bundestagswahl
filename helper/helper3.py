import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("data/rawData/kand2025.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)

parties_filename = output_dir / "parties.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited, ignore comment lines)
    df = pd.read_csv(input_filename, delimiter=";", comment="#", encoding="utf-8")

    # --- Parties CSV ---
    # Some rows may miss 'GruppennameKurz', so we fill it with 'Gruppenname' if empty
    df["GruppennameKurz"] = df["GruppennameKurz"].fillna(df["Gruppenname"])

    parties_df = (
        df[["GruppennameKurz", "Gruppenname"]]
        .dropna(subset=["Gruppenname"])
        .drop_duplicates()
        .sort_values(by=["GruppennameKurz"])
        .rename(columns={"GruppennameKurz": "Gruppenname", "Gruppenname": "GruppennameLang"})
        .reset_index(drop=True)
    )

    # Assign PartyID
    parties_df.insert(0, "PartyID", parties_df.index + 1)

    # Save output
    parties_df.to_csv(parties_filename, sep=";", index=False, encoding="utf-8")

    print(f"✅ Created '{parties_filename.name}' with {len(parties_df)} unique parties.")

except FileNotFoundError:
    print(f"❌ Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")
