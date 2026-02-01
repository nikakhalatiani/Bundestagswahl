import pandas as pd
from pathlib import Path
import unicodedata, re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

candidate_files = [
    DATA_DIR / "candidates2021.csv",
    DATA_DIR / "candidates2025.csv",
]

out_persons = OUTPUT_DIR / "persons.csv"
out_mapping = OUTPUT_DIR / "person_mapping.csv"
# ----------------------------------------------------------------------


def norm(s: str) -> str:
    """Lowercase, normalized text for comparisons."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


try:
    all_rows = []

    # Read both election years
    for path in candidate_files:
        year = int(path.stem[-4:])
        print(f"\nReading {path.name} for {year} ...")
        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip() for c in df.columns]

        required = [
            "Nachname", "Vornamen", "Geschlecht", "Geburtsjahr",
            "Geburtsort", "Künstlername", "Titel", "Namenszusatz",
            "PLZ", "Wohnort", "Beruf"
        ]
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise KeyError(f"{path.name} missing columns: {missing}")

        # Subset necessary columns
        sub = df[required].copy()
        sub["Year"] = year

        # Build composite person key
        sub["key"] = (
            sub["Nachname"].map(norm)
            + "|" + sub["Vornamen"].map(norm)
            + "|" + sub["Geschlecht"].map(norm)
            + "|" + sub["Geburtsjahr"].fillna("").astype(str).str.strip()
        )

        # ---- Detect duplicates within same year ----------------------
        dup_keys = sub["key"][sub["key"].duplicated(keep=False)]
        if not dup_keys.empty:
            print(f"Found {dup_keys.nunique()} duplicate person keys within {year}:")
            grouped = sub[sub["key"].isin(dup_keys)].groupby("key")
            for key, group in grouped:
                print(f"\nComposite key: {key}")
                print(group.to_string(index=False))
            print()  # extra blank line
        else:
            print(f"No within-year duplicate person keys detected for {year}.")

        all_rows.append(sub)

    combined = pd.concat(all_rows, ignore_index=True)

    # --- Deduplicate persons across years -----------------------------
    unique_persons = combined.drop_duplicates(subset=["key"]).reset_index(drop=True)
    unique_persons.insert(0, "PersonID", unique_persons.index + 1)

    persons_out = unique_persons[
        [
            "PersonID","Titel","Namenszusatz","Nachname","Vornamen",
            "Künstlername","Geschlecht","Geburtsjahr","PLZ",
            "Wohnort","Geburtsort","Beruf"
        ]
    ]

    persons_out.to_csv(out_persons, sep=";", index=False, encoding="utf-8")
    print(f"\nCreated '{out_persons.name}' with {len(persons_out)} unique persons.\n")

    # --- Mapping: Candidate → PersonID -------------------------------
    mapping = combined.merge(
        unique_persons[["key","PersonID"]], on="key", how="left"
    )[
        ["Year","Nachname","Vornamen","Geburtsjahr","Geburtsort","Geschlecht","PersonID"]
    ]
    mapping.to_csv(out_mapping, sep=";", index=False, encoding="utf-8")
    print(f"Saved '{out_mapping.name}' linking yearly candidates to PersonID.\n")

    # --- Yearly statistics -------------------------------------------
    total_2021 = mapping.query("Year == 2021")["PersonID"].nunique()
    total_2025 = mapping.query("Year == 2025")["PersonID"].nunique()
    both_years = mapping.groupby("PersonID")["Year"].nunique().eq(2).sum()
    total_all  = len(persons_out)

    print("Summary:")
    print(f"   2021 unique persons  : {total_2021}")
    print(f"   2025 unique persons  : {total_2025}")
    print(f"   In both elections    : {both_years}")
    print(f"   Total persons stored : {total_all}\n")

except FileNotFoundError as e:
    print(f"Missing file: {e.filename}")
except KeyError as e:
    print(f"Missing expected column: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")