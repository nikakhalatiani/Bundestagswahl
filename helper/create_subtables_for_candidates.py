import pandas as pd
from pathlib import Path
import unicodedata
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

candidate_files = [
    DATA_DIR / "candidates2021.csv",
    DATA_DIR / "candidates2025.csv",
]

# Inputs from  other scripts
PERSON_MAPPING_CSV = OUTPUT_DIR / "person_mapping.csv"
PARTY_ID_MAPPING_CSV = OUTPUT_DIR / "party_id_mapping.csv"
PARTIES_MASTER_CSV = OUTPUT_DIR / "parties.csv"  # not strictly needed

# Lookup tables
CONSTITUENCY_2021 = OUTPUT_DIR / "constituencies_2021.csv"
CONSTITUENCY_2025 = OUTPUT_DIR / "constituencies_2025.csv"
STATE_ID_MAPPING = OUTPUT_DIR / "state_id_mapping.csv"
PARTY_LIST = OUTPUT_DIR / "party_lists.csv"

# Outputs
OUT_DIRECT = OUTPUT_DIR / "direct_candidacy.csv"
OUT_LIST = OUTPUT_DIR / "party_list_candidacy.csv"
# ---------------------------------------------------------------------


def norm_text(s: str) -> str:
    """Basic normalization for names, etc."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


def normalize_party(s: str) -> str:
    """Normalise party short names for robust comparison (same as in party script)."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[–—]", "-", s)
    s = re.sub(r"\s*-\s*", " - ", s)
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


# Must match ALIASES in party mapping script
ALIASES = {
    "gesundheitsforschung": "verjüngungsforschung",
    "team todenhöfer": "die gerechtigkeitspartei - team todenhöfer",
    "die humanisten": "pdh",
    "die linke": "die linke",
}


try:
    # -----------------------------------------------------------------
    # 1) Read person_mapping to get PersonID per candidate row
    # -----------------------------------------------------------------
    print("🧭 Reading existing person_mapping.csv ...")
    mapping = pd.read_csv(PERSON_MAPPING_CSV, sep=";", encoding="utf-8-sig")
    mapping.columns = [c.strip() for c in mapping.columns]

    required_mapping_cols = [
        "Year",
        "Nachname",
        "Vornamen",
        "Geburtsjahr",
        "Geburtsort",
        "Geschlecht",
        "PersonID",
    ]
    missing = [c for c in required_mapping_cols if c not in mapping.columns]
    if missing:
        raise KeyError(f"person_mapping.csv missing columns: {missing}")

    # -----------------------------------------------------------------
    # 2) Read candidates (2021 + 2025) and attach PersonID
    # -----------------------------------------------------------------
    all_rows = []

    for path in candidate_files:
        year = int(path.stem[-4:])
        print(f"\n🗂 Reading {path.name} for {year} ...")
        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip() for c in df.columns]
        df["Year"] = year

        needed = [
            "Titel",
            "Namenszusatz",
            "Nachname",
            "Vornamen",
            "Künstlername",
            "Geschlecht",
            "Geburtsjahr",
            "PLZ",
            "Wohnort",
            "Geburtsort",
            "Beruf",
            "GruppennameKurz",
            "Listenplatz",
            "Wahlkreis",
            "Erststimmen",
            "Bundesland_Liste",
            "Year",
        ]
        missing = [c for c in needed if c not in df.columns]
        if missing:
            raise KeyError(f"{path.name} missing columns: {missing}")

        # Attach PersonID using the mapping
        df_merged = df.merge(
            mapping,
            on=[
                "Year",
                "Nachname",
                "Vornamen",
                "Geburtsjahr",
                "Geburtsort",
                "Geschlecht",
            ],
            how="left",
            validate="many_to_one",
        )

        if df_merged["PersonID"].isna().any():
            n_missing = df_merged["PersonID"].isna().sum()
            print(
                f"⚠ Warning: {n_missing} candidate rows in {year} "
                "could not be matched to a PersonID."
            )

        all_rows.append(df_merged)

    combined = pd.concat(all_rows, ignore_index=True)

    # -----------------------------------------------------------------
    # 3) Build DirectCandidacy subtable
    # -----------------------------------------------------------------
    print("\n📦 Building DirectCandidacy subtable ...")

    cons_2021 = pd.read_csv(CONSTITUENCY_2021, sep=";", encoding="utf-8-sig")
    cons_2025 = pd.read_csv(CONSTITUENCY_2025, sep=";", encoding="utf-8-sig")
    cons_2021["Year"] = 2021
    cons_2025["Year"] = 2025
    constituencies = pd.concat([cons_2021, cons_2025], ignore_index=True)
    constituencies.columns = [c.strip() for c in constituencies.columns]

    required_cons_cols = ["ConstituencyID", "Number", "Year"]
    missing_cons = [c for c in required_cons_cols if c not in constituencies.columns]
    if missing_cons:
        raise KeyError(f"Constituency files missing columns: {missing_cons}")

    direct = combined[combined["Wahlkreis"].notna()].copy()

    direct["Wahlkreis_num"] = (
        direct["Wahlkreis"]
        .astype(str)
        .str.replace(",", ".", regex=False)
        .str.strip()
    )
    direct["Wahlkreis_num"] = direct["Wahlkreis_num"].replace(
        {"": None, "nan": None}
    )
    direct["Wahlkreis_num"] = direct["Wahlkreis_num"].astype(float).astype("Int64")

    constituencies["Number"] = constituencies["Number"].astype("Int64")
    direct = direct.merge(
        constituencies[["Year", "Number", "ConstituencyID"]],
        left_on=["Year", "Wahlkreis_num"],
        right_on=["Year", "Number"],
        how="left",
    )

    if direct["ConstituencyID"].isna().any():
        n_missing = direct["ConstituencyID"].isna().sum()
        print(
            f"⚠ Warning: {n_missing} direct candidacy rows "
            f"could not be matched to a ConstituencyID."
        )

    direct["Erststimmen"] = (
        direct["Erststimmen"]
        .astype(str)
        .str.replace(",", ".", regex=False)
        .str.strip()
    )
    direct["Erststimmen"] = direct["Erststimmen"].replace(
        {"": None, "nan": None}
    )
    direct["Erststimmen"] = direct["Erststimmen"].astype(float)

    direct_out = direct[["PersonID", "Year", "ConstituencyID", "Erststimmen"]].copy()
    direct_out = direct_out.dropna(subset=["PersonID", "ConstituencyID"])
    direct_out = direct_out.drop_duplicates().sort_values(["Year", "PersonID"])

    direct_out.to_csv(OUT_DIRECT, sep=";", index=False, encoding="utf-8-sig")
    print(
        f"✅ Saved DirectCandidacy with {len(direct_out)} rows to '{OUT_DIRECT.name}'"
    )

    # -----------------------------------------------------------------
    # 4) Build PartyListCandidacy subtable (with full normalization)
    # -----------------------------------------------------------------
    print("\n📦 Building PartyListCandidacy subtable ...")

    # Load state mapping and party_list
    state_map = pd.read_csv(STATE_ID_MAPPING, sep=";", encoding="utf-8-sig")
    state_map.columns = [c.strip() for c in state_map.columns]

    party_list = pd.read_csv(PARTY_LIST, sep=";", encoding="utf-8-sig")
    party_list.columns = [c.strip() for c in party_list.columns]

    # Load party_id_mapping
    party_id_map = pd.read_csv(PARTY_ID_MAPPING_CSV, sep=";", encoding="utf-8-sig")
    party_id_map.columns = [c.strip() for c in party_id_map.columns]

    # Expect columns:
    # state_id_mapping: StateID;GebietLandAbk;Gebietsname
    # party_list: PartyListID;Year;StateID;PartyID;VoteCount
    # party_id_mapping: Year;ShortName;LongName;PartyID
    for df_name, df_obj, cols in [
        ("state_id_mapping.csv", state_map, ["StateID", "GebietLandAbk"]),
        ("party_list.csv", party_list, ["PartyListID", "Year", "StateID", "PartyID"]),
        (
            "party_id_mapping.csv",
            party_id_map,
            ["Year", "ShortName", "PartyID"],
        ),
    ]:
        missing = [c for c in cols if c not in df_obj.columns]
        if missing:
            raise KeyError(f"{df_name} missing columns: {missing}")

    # Party-list candidacy: where Listenplatz is not null
    plist = combined[combined["Listenplatz"].notna()].copy()

    # Map Bundesland_Liste (e.g. 'NW') -> StateID via GebietLandAbk
    plist = plist.merge(
        state_map[["StateID", "GebietLandAbk"]],
        left_on="Bundesland_Liste",
        right_on="GebietLandAbk",
        how="left",
    )

    if plist["StateID"].isna().any():
        n_missing = plist["StateID"].isna().sum()
        print(
            f"⚠ Warning: {n_missing} party-list rows could not be matched to a StateID."
        )

    # --- Party normalization and mapping via party_id_mapping --------
    # Normalize GruppennameKurz and map aliases (same as parties script)
    plist["NormPartyShort"] = (
        plist["GruppennameKurz"].map(normalize_party).apply(
            lambda s: ALIASES.get(s, s)
        )
    )

    # party_id_map: compute a normalized short name too
    party_id_map["NormPartyShort"] = party_id_map["ShortName"].map(
        normalize_party
    ).apply(lambda s: ALIASES.get(s, s))

    # Ensure unique mapping per (Year, NormPartyShort)
    party_id_map_unique = (
        party_id_map.sort_values(["Year", "NormPartyShort"])
        .drop_duplicates(subset=["Year", "NormPartyShort"], keep="last")
    )

    # Sanity check: no duplicates left
    dup_check = party_id_map_unique.duplicated(
        subset=["Year", "NormPartyShort"], keep=False
    )
    if dup_check.any():
        raise ValueError(
            "party_id_map_unique still has duplicate (Year, NormPartyShort) keys."
        )

    # Now join on (Year, NormPartyShort) to get PartyID
    plist = plist.merge(
        party_id_map_unique[["Year", "NormPartyShort", "PartyID"]],
        on=["Year", "NormPartyShort"],
        how="left",
        validate="many_to_one",
    )

    if plist["PartyID"].isna().any():
        n_missing = plist["PartyID"].isna().sum()
        print(
            f"⚠ Warning: {n_missing} party-list rows could not be matched to a PartyID."
        )

    # Join to party_list to get PartyListID
    plist = plist.merge(
        party_list[["PartyListID", "Year", "StateID", "PartyID"]],
        on=["Year", "StateID", "PartyID"],
        how="left",
        validate="many_to_one",
    )

    if plist["PartyListID"].isna().any():
        n_missing = plist["PartyListID"].isna().sum()
        print(
            f"⚠ Warning: {n_missing} party-list rows could not be matched "
            f"to a PartyListID."
        )

    # Normalize Listenplatz
    plist["Listenplatz"] = (
        plist["Listenplatz"]
        .astype(str)
        .str.replace(",", ".", regex=False)
        .str.strip()
    )
    plist["Listenplatz"] = plist["Listenplatz"].replace({"": None, "nan": None})
    plist["Listenplatz"] = plist["Listenplatz"].astype(float).astype("Int64")

    plist_out = plist[["PersonID", "Year", "PartyListID", "Listenplatz"]].copy()
    plist_out = plist_out.dropna(subset=["PersonID", "PartyListID"])
    plist_out = plist_out.drop_duplicates().sort_values(["Year", "PersonID"])

    plist_out.to_csv(OUT_LIST, sep=";", index=False, encoding="utf-8-sig")
    print(
        f"✅ Saved PartyListCandidacy with {len(plist_out)} rows to '{OUT_LIST.name}'"
    )

    print("\n🎉 Done.\n")

except FileNotFoundError as e:
    print(f"❌ Missing file: {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")