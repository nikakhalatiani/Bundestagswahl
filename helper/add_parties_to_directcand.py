import pandas as pd
from pathlib import Path
import unicodedata
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

DIRECT_CANDIDACY = "data/direct_candidacy.csv"
PERSONS_CSV =  "data/persons.csv"
PARTY_MAP_CSV = "data/old2.0/party_id_mapping.csv"

CANDIDATE_FILES = [
    Path("data/old2.0/candidates2021.csv"),
    Path("data/old2.0/candidates2025.csv"),
]

OUT_FILE = OUTPUT_DIR / "direct_candidacy_with_party.csv"
# ---------------------------------------------------------------------


def norm(s: str) -> str:
    """Lowercase + NFKC normalization."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


def build_person_key(df: pd.DataFrame) -> pd.Series:
    """Composite key Nachname|Vornamen|Geschlecht|Geburtsjahr."""
    return (
        df["Nachname"].map(norm)
        + "|" + df["Vornamen"].map(norm)
        + "|" + df["Geschlecht"].map(norm)
        + "|" + df["Geburtsjahr"].fillna("").astype(str).str.strip()
    )


try:
    # ------------------------------------------------------------------
    # 1. Load data
    # ------------------------------------------------------------------
    print("🧭 Loading CSVs ...")

    direct = pd.read_csv(DIRECT_CANDIDACY, sep=";", encoding="utf-8-sig")
    persons = pd.read_csv(PERSONS_CSV, sep=";", encoding="utf-8-sig")
    party_map = pd.read_csv(PARTY_MAP_CSV, sep=";", encoding="utf-8-sig")

    persons.columns = [c.strip() for c in persons.columns]
    direct.columns = [c.strip() for c in direct.columns]
    party_map.columns = [c.strip() for c in party_map.columns]

    print(f"Loaded {len(direct)} direct candidacy rows.")
    print(f"Loaded {len(persons)} persons.")
    print(f"Loaded {len(party_map)} party map rows.")

    # ------------------------------------------------------------------
    # 2. Build master lookup (person → party short name → PartyID)
    # ------------------------------------------------------------------
    # Step A: create key for persons
    persons["key"] = (
        persons["Nachname"].map(norm)
        + "|" + persons["Vornamen"].map(norm)
        + "|" + persons["Geschlecht"].map(norm)
        + "|" + persons["Geburtsjahr"].fillna("").astype(str).str.strip()
    )

    # Step B: read candidate files and build Year + key -> GruppennameKurz
    all_candidates = []
    for path in CANDIDATE_FILES:
        if not path.exists():
            print(f"⚠ {path.name} not found, skipping that year.")
            continue
        year = int(path.stem[-4:])
        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip() for c in df.columns]

        required = [
            "Nachname",
            "Vornamen",
            "Geschlecht",
            "Geburtsjahr",
            "GruppennameKurz",
        ]
        missing = [c for c in required if c not in df.columns]
        if missing:
            print(f"⚠ {path.name} missing {missing}, skipping.")
            continue

        df["key"] = build_person_key(df)
        df["Year"] = year
        all_candidates.append(df[["Year", "key", "GruppennameKurz"]])

        print(f"✅ Loaded {len(df)} candidates for {year}.")

    cand_all = pd.concat(all_candidates, ignore_index=True) if all_candidates else pd.DataFrame()

    # Step C: join party_id_mapping to map Year + ShortName -> PartyID
    party_map.rename(
        columns={"ShortName": "GruppennameKurz"},
        inplace=True,
    )
    cand_party = cand_all.merge(
        party_map[["Year", "GruppennameKurz", "PartyID"]],
        on=["Year", "GruppennameKurz"],
        how="left",
    )

    # Some small parties may not be found
    missing_pids = cand_party["PartyID"].isna().sum()
    if missing_pids:
        print(f"⚠ {missing_pids} candidate rows have no PartyID mapping.")

    print(f"✅ Combined candidate-party info: {len(cand_party)} rows.")

    # ------------------------------------------------------------------
    # 3. Link direct_candidacy → persons → candidates → PartyID
    # ------------------------------------------------------------------
    # Attach person key
    direct_keyed = direct.merge(persons[["PersonID", "key"]], on="PersonID", how="left")

    # Add Year + key join to candidate party info
    direct_party = direct_keyed.merge(
        cand_party[["Year", "key", "PartyID"]],
        on=["Year", "key"],
        how="left",
    )

    direct_party.drop(columns=["key"], inplace=True)
    direct_party["PartyID"] = direct_party["PartyID"].astype("Int64")

    missing_party = direct_party["PartyID"].isna().sum()
    if missing_party:
        print(f"⚠ {missing_party} direct candidates lack matching PartyID.")

    # ------------------------------------------------------------------
    # 4. Save updated CSV
    # ------------------------------------------------------------------
    direct_party.to_csv(OUT_FILE, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved updated direct_candidacy_with_party.csv with {len(direct_party)} rows.")
    print("   Columns:", ", ".join(direct_party.columns))

except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")