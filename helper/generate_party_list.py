import pandas as pd
from pathlib import Path

# --- Configuration ---
input_filename = Path("data/rawData/kand2021.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)

parties_filename = output_dir / "parties.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited)
    df = pd.read_csv(input_filename, delimiter=";", encoding="utf-8")

    # --- Parties CSV ---
    # Detect party columns (2025: GruppennameKurz + Gruppenname, 2021: Gruppenname + GruppennameLang)
    if "GruppennameKurz" in df.columns and "Gruppenname" in df.columns:
        short_col = "GruppennameKurz"
        long_col = "Gruppenname"
    elif "Gruppenname" in df.columns and "GruppennameLang" in df.columns:
        short_col = "Gruppenname"
        long_col = "GruppennameLang"
    else:
        raise KeyError(
            "No recognized party name columns (expected GruppennameKurz+Gruppenname or Gruppenname+GruppennameLang)")

    # Ensure a short name column exists
    df[short_col] = df[short_col].fillna(df.get(long_col))

    parties_df = (
        df[[short_col, long_col]]
        .dropna(subset=[short_col])
        .drop_duplicates()
        .sort_values(by=[short_col])
        .reset_index(drop=True)
    )
    # Normalize columns to PartyID, Gruppenname, GruppennameLang
    parties_df = parties_df.rename(
        columns={short_col: "Gruppenname", long_col: "GruppennameLang"})

    # Assign PartyID
    parties_df.insert(0, "PartyID", parties_df.index + 1)

    # Save output
    parties_df.to_csv(parties_filename, sep=";", index=False, encoding="utf-8")

    print(
        f"Created '{parties_filename.name}' with {len(parties_df)} unique parties.")

except FileNotFoundError:
    print(f"Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"Missing expected column: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")