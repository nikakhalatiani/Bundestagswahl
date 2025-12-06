import pandas as pd
from pathlib import Path
import unicodedata
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Inputs
KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2.csv"

CONSTITUENCY_2021 = OUTPUT_DIR / "constituencies_2021.csv"
CONSTITUENCY_2025 = OUTPUT_DIR / "constituencies_2025.csv"

PERSON_MAPPING_CSV = OUTPUT_DIR / "person_mapping.csv"
CANDIDATES_2021 = DATA_DIR / "candidates2021.csv"
CANDIDATES_2025 = DATA_DIR / "candidates2025.csv"

DIRECT_CANDIDACY_CSV = OUTPUT_DIR / "direct_candidacy.csv"
CONSTIT_ELECTIONS_CSV = OUTPUT_DIR / "constituency_elections.csv"

PARTY_ID_MAPPING_CSV = OUTPUT_DIR / "party_id_mapping.csv"

# Outputs
OUT_DIRECT_FILLED = OUTPUT_DIR / "direct_candidacy_filled.csv"
OUT_CONSTIT_ELECTIONS_ENRICHED = (
    OUTPUT_DIR / "constituency_elections_enriched.csv"
)
OUT_CONSTIT_PARTY_VOTES = OUTPUT_DIR / "constituency_party_votes.csv"
# ---------------------------------------------------------------------


def normalize_party(s: str) -> str:
    """Normalise party short names for comparison."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[–—]", "-", s)
    s = re.sub(r"\s*-\s*", " - ", s)
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


ALIASES = {
    "gesundheitsforschung": "verjüngungsforschung",
    "team todenhöfer": "die gerechtigkeitspartei - team todenhöfer",
    "die humanisten": "pdh",
    "die linke": "die linke",
}


def add_norm_party_short(df: pd.DataFrame, col: str, out_col: str) -> pd.DataFrame:
    df[out_col] = df[col].map(normalize_party).apply(lambda s: ALIASES.get(s, s))
    return df


def load_kerg(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df


try:
    # -----------------------------------------------------------------
    # 1) Load and combine KERG_2 Wahlkreis-level data (both years)
    # -----------------------------------------------------------------
    print("🧾 Loading KERG _2 files ...")
    kerg21 = load_kerg(KERG_2021, 2021)
    kerg25 = load_kerg(KERG_2025, 2025)
    kerg = pd.concat([kerg21, kerg25], ignore_index=True)

    # Restrict to Wahlkreis rows
    kerg_wk = kerg[kerg["Gebietsart"] == "Wahlkreis"].copy()
    print(f"📊 Wahlkreis rows in KERG_2 total: {len(kerg_wk)}")

    # Parse Gebietsnummer as int (Wahlkreis number)
    kerg_wk["Gebietsnummer_int"] = (
        kerg_wk["Gebietsnummer"]
        .astype(str)
        .str.strip()
        .replace({"": None, "nan": None})
        .astype(float)
        .astype("Int64")
    )

    # Normalize Anzahl to float
    # Correct parsing
    kerg_wk["Anzahl"] = (
        kerg_wk["Anzahl"]
        .astype(str)
        .str.replace(",", ".", regex=False)
        .str.strip()
    )
    kerg_wk["Anzahl"] = pd.to_numeric(kerg_wk["Anzahl"], errors="coerce")

    # -----------------------------------------------------------------
    # 2) Load constituencies and build (Year, Number) → ConstituencyID
    # -----------------------------------------------------------------
    cons_2021 = pd.read_csv(CONSTITUENCY_2021, sep=";", encoding="utf-8-sig")
    cons_2025 = pd.read_csv(CONSTITUENCY_2025, sep=";", encoding="utf-8-sig")
    cons_2021["Year"] = 2021
    cons_2025["Year"] = 2025
    constituencies = pd.concat([cons_2021, cons_2025], ignore_index=True)
    constituencies.columns = [c.strip() for c in constituencies.columns]
    constituencies["Number"] = constituencies["Number"].astype("Int64")

    # attach ConstituencyID to KERG
    kerg_wk = kerg_wk.merge(
        constituencies[["Year", "Number", "ConstituencyID"]],
        left_on=["Year", "Gebietsnummer_int"],
        right_on=["Year", "Number"],
        how="left",
    )

    if kerg_wk["ConstituencyID"].isna().any():
        n_bad = kerg_wk["ConstituencyID"].isna().sum()
        print(
            f"⚠ Warning: {n_bad} Wahlkreis rows in KERG could not be mapped "
            "to a ConstituencyID."
        )

    # -----------------------------------------------------------------
    # 3) PART A: Fill missing Erststimmen in direct_candidacy.csv
    # -----------------------------------------------------------------
    print("\n🧭 Filling missing Erststimmen in direct_candidacy ...")
    direct = pd.read_csv(DIRECT_CANDIDACY_CSV, sep=";", encoding="utf-8-sig")
    direct.columns = [c.strip() for c in direct.columns]

    for col in ["PersonID", "Year", "ConstituencyID", "Erststimmen"]:
        if col not in direct.columns:
            raise KeyError(f"direct_candidacy.csv missing column: {col}")

    direct["Erststimmen"] = (
        direct["Erststimmen"]
        .astype(str)
        .str.replace(",", ".", regex=False)
        .str.strip()
        .replace({"": None, "nan": None})
        .astype(float)
    )

    missing_mask = direct["Erststimmen"].isna()
    n_missing = missing_mask.sum()
    print(f"🔍 Found {n_missing} rows with missing Erststimmen.")

    if n_missing > 0:
        # Rebuild candidate mapping to know Wahlkreis (Number) and GruppennameKurz
        person_mapping = pd.read_csv(
            PERSON_MAPPING_CSV, sep=";", encoding="utf-8-sig"
        )
        person_mapping.columns = [c.strip() for c in person_mapping.columns]

        all_cand = []
        for path in [CANDIDATES_2021, CANDIDATES_2025]:
            year = int(path.stem[-4:])
            df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
            df.columns = [c.strip() for c in df.columns]
            df["Year"] = year

            df = df.merge(
                person_mapping,
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
            all_cand.append(df)

        cand_combined = pd.concat(all_cand, ignore_index=True)
        cand_direct = cand_combined[cand_combined["Wahlkreis"].notna()].copy()

        cand_direct["Wahlkreis_int"] = (
            cand_direct["Wahlkreis"]
            .astype(str)
            .str.replace(",", ".", regex=False)
            .str.strip()
            .replace({"": None, "nan": None})
            .astype(float)
            .astype("Int64")
        )

        cand_key = cand_direct[
            ["PersonID", "Year", "Wahlkreis_int", "GruppennameKurz"]
        ].drop_duplicates()

        # Attach Wahlkreis_int & GruppennameKurz to direct rows
        direct_ext = direct.merge(
            cand_key,
            on=["PersonID", "Year"],
            how="left",
            validate="many_to_one",
        )

        # KERG party data: Erststimme rows (Stimme == 1, Gruppenart == Partei)
        kerg_direct = kerg_wk[
            (kerg_wk["Gruppenart"] == "Partei")
            & (kerg_wk["Stimme"].astype(str).str.strip() == "1")
        ].copy()

        kerg_direct_key = kerg_direct[
            [
                "Year",
                "Gebietsnummer_int",
                "Gruppenname",
                "Anzahl",
                "ConstituencyID",
            ]
        ].drop_duplicates()

        # Work only on missing rows
        missing_ext = direct_ext[missing_mask].copy()

        # Join: Year, Wahlkreis_int == Gebietsnummer_int, party-label straight
        missing_ext = missing_ext.merge(
            kerg_direct_key,
            left_on=["Year", "Wahlkreis_int", "GruppennameKurz"],
            right_on=["Year", "Gebietsnummer_int", "Gruppenname"],
            how="left",
        )

        fillable_mask = missing_ext["Anzahl"].notna()
        n_fillable = fillable_mask.sum()
        print(f"✅ Can fill Erststimmen for {n_fillable} of {n_missing} missing rows.")

        fill_values = missing_ext.loc[
            fillable_mask, ["PersonID", "Year", "ConstituencyID_x", "Anzahl"]
        ].copy()
        fill_values = fill_values.rename(
            columns={"ConstituencyID_x": "ConstituencyID", "Anzahl": "Erststimmen_fill"}
        )

        direct_filled = direct.merge(
            fill_values,
            on=["PersonID", "Year", "ConstituencyID"],
            how="left",
        )
        direct_filled["Erststimmen"] = direct_filled["Erststimmen"].fillna(
            direct_filled["Erststimmen_fill"]
        )
        direct_filled = direct_filled.drop(columns=["Erststimmen_fill"])
    else:
        direct_filled = direct

    direct_filled.to_csv(OUT_DIRECT_FILLED, sep=";", index=False, encoding="utf-8-sig")
    still_missing = direct_filled["Erststimmen"].isna().sum()
    print(
        f"📊 Erststimmen: originally missing = {n_missing}, "
        f"now still missing = {still_missing}"
    )
    print(f"💾 Saved updated direct candidacies to '{OUT_DIRECT_FILLED.name}'")

    # -----------------------------------------------------------------
    # 4) PART B: Enrich constituency_elections with electorate/turnout
    # -----------------------------------------------------------------
    print("\n🧭 Enriching constituency_elections with electorate stats ...")
    const_elec = pd.read_csv(CONSTIT_ELECTIONS_CSV, sep=";", encoding="utf-8-sig")
    const_elec.columns = [c.strip() for c in const_elec.columns]

    # Expect BridgeID;Year;ConstituencyID at least
    for col in ["BridgeID", "Year", "ConstituencyID"]:
        if col not in const_elec.columns:
            raise KeyError(f"constituency_elections.csv missing column: {col}")

    # System-Gruppe rows contain electorate/valid/invalid etc.
    kerg_sys = kerg_wk[kerg_wk["Gruppenart"] == "System-Gruppe"].copy()

    # For each constituency/year extract:
    # - Wahlberechtigte (eligible voters)  -> Stimme empty
    # - Wählende (total voters)           -> Stimme empty
    # - Ungültige (invalid), Gültige (valid) per Stimme (1,2)
    def extract_system_agg(df: pd.DataFrame) -> pd.DataFrame:
        out = {}
        for (_, row) in df.iterrows():
            name = row["Gruppenname"]
            stimme = str(row["Stimme"]).strip()
            val = row["Anzahl"]

            if name == "Wahlberechtigte":
                out["EligibleVoters"] = val
            elif name == "Wählende":
                out["TotalVoters"] = val
            elif name == "Ungültige" and stimme == "1":
                out["InvalidFirst"] = val
            elif name == "Ungültige" and stimme == "2":
                out["InvalidSecond"] = val
            elif name == "Gültige" and stimme == "1":
                out["ValidFirst"] = val
            elif name == "Gültige" and stimme == "2":
                out["ValidSecond"] = val
        return pd.Series(out)

    sys_agg = (
        kerg_sys.groupby(["Year", "ConstituencyID"])
        .apply(extract_system_agg)
        .reset_index()
    )

    const_elec_enriched = const_elec.merge(
        sys_agg,
        on=["Year", "ConstituencyID"],
        how="left",
    )

    const_elec_enriched.to_csv(
        OUT_CONSTIT_ELECTIONS_ENRICHED, sep=";", index=False, encoding="utf-8-sig"
    )
    print(
        f"💾 Saved enriched constituency elections to "
        f"'{OUT_CONSTIT_ELECTIONS_ENRICHED.name}'"
    )

    # -----------------------------------------------------------------
    # 5) PART C: Create constituency_party_votes.csv
    # -----------------------------------------------------------------
    print("\n🧭 Building constituency_party_votes (per party, per Wahlkreis) ...")

    # Load party_id_mapping to map KERG Gruppenname → PartyID
    party_id_map = pd.read_csv(PARTY_ID_MAPPING_CSV, sep=";", encoding="utf-8-sig")
    party_id_map.columns = [c.strip() for c in party_id_map.columns]
    party_id_map = add_norm_party_short(party_id_map, "ShortName", "NormPartyShort")
    party_id_map_unique = (
        party_id_map.sort_values(["Year", "NormPartyShort"])
        .drop_duplicates(subset=["Year", "NormPartyShort"], keep="last")
    )

    # Party rows in KERG: Gruppenart == Partei
    kerg_party = kerg_wk[kerg_wk["Gruppenart"] == "Partei"].copy()
    kerg_party = add_norm_party_short(kerg_party, "Gruppenname", "NormPartyShort")

    # Map to PartyID via (Year, NormPartyShort)
    kerg_party = kerg_party.merge(
        party_id_map_unique[["Year", "NormPartyShort", "PartyID"]],
        on=["Year", "NormPartyShort"],
        how="left",
    )

    # We'll keep both Stimme 1 (Erststimme) and 2 (Zweitstimme) in one table
    # VoteType: 1 or 2
    kerg_party_votes = kerg_party[
        ["Year", "ConstituencyID", "PartyID", "Stimme", "Anzahl"]
    ].copy()

    # Rename for clarity
    kerg_party_votes = kerg_party_votes.rename(
        columns={"Stimme": "VoteType", "Anzahl": "Votes"}
    )
    # VoteType as Int64 (1 or 2)
    kerg_party_votes["VoteType"] = (
        kerg_party_votes["VoteType"]
        .astype(str)
        .str.strip()
        .replace({"": None, "nan": None})
        .astype(float)
        .astype("Int64")
    )

    # Attach BridgeID (constituency_elections) via Year + ConstituencyID
    const_bridge = const_elec_enriched[["BridgeID", "Year", "ConstituencyID"]].copy()
    votes_with_bridge = kerg_party_votes.merge(
        const_bridge, on=["Year", "ConstituencyID"], how="left"
    )

    # Final columns: BridgeID, Year, ConstituencyID, PartyID, VoteType, Votes
    const_party_out = votes_with_bridge[
        ["BridgeID", "Year", "ConstituencyID", "PartyID", "VoteType", "Votes"]
    ].copy()

    const_party_out.to_csv(
        OUT_CONSTIT_PARTY_VOTES, sep=";", index=False, encoding="utf-8-sig"
    )

    print(
        f"💾 Saved constituency_party_votes to "
        f"'{OUT_CONSTIT_PARTY_VOTES.name}' with {len(const_party_out)} rows"
    )

    print("\n🎉 Done.\n")

except FileNotFoundError as e:
    print(f"❌ Missing file: {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")