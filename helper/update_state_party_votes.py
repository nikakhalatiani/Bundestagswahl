import pandas as pd
from pathlib import Path

# --- Configuration ---
input_results = Path("data/rawData/kerg2021_2.csv")
input_states = Path("Bundestagswahl/outputs/states.csv")
input_state_parties = Path("Bundestagswahl/outputs/state_parties.csv")
output_filename = Path("Bundestagswahl/outputs/state_parties.csv")
# --- End of Configuration ---

try:
    # --- Load CSVs ---
    results_df = pd.read_csv(input_results, delimiter=";", encoding="utf-8")
    states_df = pd.read_csv(input_states, delimiter=";", encoding="utf-8")
    state_parties_df = pd.read_csv(
        input_state_parties, delimiter=";", encoding="utf-8")

    # --- Filter for Land-level results ---
    land_results = results_df[results_df["Gebietsart"] == "Land"].copy()

    # --- Map long state names to abbreviations ---
    # Create mapping dict from states.csv
    state_name_to_abbr = dict(
        zip(states_df["Gebietsname"], states_df["GebietLandAbk"]))

    # Map Gebietsname to GebietLandAbk
    land_results["GebietLandAbk"] = land_results["Gebietsname"].map(
        state_name_to_abbr)

    # --- Aggregate Anzahl by state and party ---
    # results files may use 'Gruppenname' or 'GruppennameLang' for party name
    if "Gruppenname" in land_results.columns:
        results_party_col = "Gruppenname"
    elif "GruppennameLang" in land_results.columns:
        results_party_col = "GruppennameLang"
    else:
        raise KeyError(
            "No recognized party column in results (Gruppenname or GruppennameLang)")

    aggregated = (
        land_results.groupby(["GebietLandAbk", results_party_col])["Anzahl"]
        .sum()
        .reset_index()
    )

    # --- Merge with state_parties ---
    # left state_parties_df uses GruppennameKurz; results may use results_party_col
    merged = pd.merge(
        state_parties_df,
        aggregated,
        left_on=["GebietLandAbk", "GruppennameKurz"],
        right_on=["GebietLandAbk", results_party_col],
        how="left"
    )

    # Drop the duplicate Gruppenname column from the merge
    merged.drop(columns=["Gruppenname"], inplace=True, errors="ignore")

    # Save output
    merged.to_csv(output_filename, sep=";", index=False, encoding="utf-8")

    # --- Summary ---
    total_pairs = len(merged)
    matched_pairs = merged["Anzahl"].notna().sum()
    print(f"Updated '{output_filename.name}' with vote counts.")
    print(
        f"   {matched_pairs}/{total_pairs} state/party combinations have vote data.")

except FileNotFoundError as e:
    print(f"Error: Missing file -> {e.filename}")
except KeyError as e:
    print(f"Missing expected column: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")