import re
import unicodedata
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------
# Configuration (adjust filenames if differ)
# ---------------------------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"

KAND_2021 = RAW_DIR / "kand2021.csv"
KAND_2025 = RAW_DIR / "kand2025.csv"

PERSONS_CSV = DATA_DIR / "persons.csv"
DIRECT_CSV = DATA_DIR / "direct_candidacy.csv"
PLC_CSV = DATA_DIR / "party_list_candidacy.csv"

# Mappings
PARTY_MAP_CSV = DATA_DIR / "old2.0/party_id_mapping.csv"
STATE_MAP_CSV = DATA_DIR / "old2.0/state_id_mapping.csv"  # must have GebietLandAbk, StateID

CONST_2021 = DATA_DIR / "old2.0/constituencies_2021.csv"
CONST_2025 = DATA_DIR / "old2.0/constituencies_2025.csv"

PARTY_LISTS_CSV = DATA_DIR / "party_lists.csv"

# Outputs
OUT_PERSONS = DATA_DIR / "persons_updated.csv"
OUT_DIRECT = DATA_DIR / "direct_candidacy_updated.csv"
OUT_PLC = DATA_DIR / "party_list_candidacy_updated.csv"
# ---------------------------------------------------------------------


def load_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.replace("\ufeff", "").strip() for c in df.columns]
    return df


def norm(s) -> str:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = str(s).strip()
    s = unicodedata.normalize("NFKC", s)
    s = s.lower()
    s = re.sub(r"\s+", " ", s)
    return s


def person_key(df: pd.DataFrame) -> pd.Series:
    return (
        df["Nachname"].map(norm)
        + "|"
        + df["Vornamen"].map(norm)
        + "|"
        + df["Geschlecht"].map(norm)
        + "|"
        + df["Geburtsjahr"].fillna("").astype(str).str.strip()
    )


def to_int(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype("Int64")


def extract_year_from_wahltag(df: pd.DataFrame, fallback_year: int) -> pd.Series:
    if "Wahltag" not in df.columns:
        return pd.Series([fallback_year] * len(df), index=df.index, dtype="Int64")

    # Wahltag like "26.09.2021"
    y = (
        df["Wahltag"]
        .astype(str)
        .str.extract(r"(\d{4})", expand=False)
        .astype("Int64")
    )
    y = y.fillna(fallback_year).astype("Int64")
    return y


ALIASES = {
    "team todenhöfer": "die gerechtigkeitspartei - team todenhöfer",
    "die humanisten": "pdh",
    "gesundheitsforschung": "verjüngungsforschung",
    "die linke": "die linke",
}


def norm_party(s: str) -> str:
    s = norm(s)
    return ALIASES.get(s, s)


def build_party_lookup(party_map: pd.DataFrame):
    """
    Returns dicts for year-aware matching:
      short[(year, norm_short)] -> PartyID (or None if ambiguous)
      long[(year, norm_long)] -> PartyID (or None if ambiguous)
    """
    pm = party_map.copy()
    if "Year" not in pm.columns:
        pm["Year"] = pd.NA
    pm["Year"] = to_int(pm["Year"])
    pm["NormShort"] = pm["ShortName"].map(norm_party)
    pm["NormLong"] = pm["LongName"].map(norm_party)
    pm["PartyID"] = to_int(pm["PartyID"])

    def build_map(col: str):
        d = {}
        grp = pm.groupby(["Year", col])["PartyID"].apply(lambda x: sorted(set(x)))
        for (year, key), ids in grp.items():
            if key == "":
                continue
            if len(ids) == 1:
                d[(year, key)] = int(ids[0])
            else:
                # ambiguous
                d[(year, key)] = None
        return d, grp

    short_map, short_grp = build_map("NormShort")
    long_map, long_grp = build_map("NormLong")
    return short_map, long_map, short_grp, long_grp


def map_party_id(
    year: int,
    raw_short: str | None,
    raw_long: str | None,
    short_map,
    long_map,
) -> int | None:
    """
    Match priority:
      1) short name
      2) long name
      3) short name with EB: *** -> EB:*** normalization
    Returns PartyID or None.
    """
    s_short = norm_party(raw_short or "")
    s_long = norm_party(raw_long or "")

    pid = short_map.get((year, s_short))
    if pid is not None:
        return pid

    pid = long_map.get((year, s_long))
    if pid is not None:
        return pid

    # EB: *** -> EB:*** retry
    if s_short.startswith("eb: "):
        s_short2 = "eb:" + s_short[4:]
        pid = short_map.get((year, s_short2))
        if pid is not None:
            return pid

    return None


def coalesce_cols(df: pd.DataFrame, cols: list[str]) -> pd.Series:
    out = pd.Series([None] * len(df), index=df.index, dtype="object")
    for c in cols:
        if c in df.columns:
            out = out.combine_first(df[c])
    return out


def extract_direct_rows(kand: pd.DataFrame, year: int) -> pd.DataFrame:
    """
    Extract direct candidacy from:
      - main row where Kennzeichen indicates Kreiswahlvorschlag AND Gebietsart=Wahlkreis
      - linked (Verkn*) row where VerknKennzeichen indicates Kreiswahlvorschlag
    """
    k = kand.copy()
    k["Year"] = year

    # main direct
    DIRECT_KENN = {"kreiswahlvorschlag", "anderer kreiswahlvorschlag"}

    main = k[
        (k["Gebietsart"].astype(str).str.casefold() == "wahlkreis")
        & (k["Kennzeichen"].astype(str).str.casefold().isin(DIRECT_KENN))
    ].copy()

    verkn = k[
        (k.get("VerknGebietsart", "").astype(str).str.casefold() == "wahlkreis")
        & (k.get("VerknKennzeichen", "").astype(str).str.casefold().isin(DIRECT_KENN))
    ].copy()

    def build(df: pd.DataFrame, mode: str) -> pd.DataFrame:
        if df.empty:
            return df.assign(_mode=mode)

        if mode == "main":
            wk_num = coalesce_cols(df, ["Gebietsnummer"])
            party_short = coalesce_cols(df, ["GruppennameKurz", "Gruppenname"])
            party_long = coalesce_cols(df, ["Gruppenname", "GruppennameLang"])
        else:
            wk_num = coalesce_cols(df, ["VerknGebietsnummer"])
            party_short = coalesce_cols(df, ["VerknGruppenname"])
            party_long = coalesce_cols(df, ["VerknGruppenname"])

        out = pd.DataFrame(
            {
                "Year": df["Year"].astype("Int64"),
                "WahlkreisNumber": to_int(wk_num),
                "PartyShortRaw": party_short,
                "PartyLongRaw": party_long,
                "PreviouslyElected": df.get("VorpGewaehlt", "")
                .astype(str)
                .str.strip()
                .str.upper()
                .eq("X"),
            }
        )
        out["_mode"] = mode
        out["_row_index"] = df.index
        return out

    res = pd.concat([build(main, "main"), build(verkn, "verkn")], ignore_index=True)
    return res


def extract_list_rows(kand: pd.DataFrame, year: int) -> pd.DataFrame:
    """
    Extract list candidacy from:
      - main row where Kennzeichen indicates Landesliste AND Gebietsart=Land
      - linked (Verkn*) row where VerknKennzeichen indicates Landesliste
    """
    k = kand.copy()
    k["Year"] = year

    main = k[
        (k["Gebietsart"].astype(str).str.lower() == "land")
        & (k["Kennzeichen"].astype(str).str.lower() == "landesliste")
    ].copy()

    verkn = k[
        (k.get("VerknGebietsart", "").astype(str).str.lower() == "land")
        & (k.get("VerknKennzeichen", "").astype(str).str.lower() == "landesliste")
    ].copy()

    def build(df: pd.DataFrame, mode: str) -> pd.DataFrame:
        if df.empty:
            return df.assign(_mode=mode)

        if mode == "main":
            state_abk = coalesce_cols(df, ["GebietLandAbk"])
            party_short = coalesce_cols(df, ["GruppennameKurz", "Gruppenname"])
            party_long = coalesce_cols(df, ["Gruppenname", "GruppennameLang"])
            listenplatz = coalesce_cols(df, ["Listenplatz"])
        else:
            state_abk = coalesce_cols(df, ["VerknGebietLandAbk"])
            party_short = coalesce_cols(df, ["VerknGruppenname"])
            party_long = coalesce_cols(df, ["VerknGruppenname"])
            listenplatz = coalesce_cols(df, ["VerknListenplatz"])

        out = pd.DataFrame(
            {
                "Year": df["Year"].astype("Int64"),
                "StateAbk": state_abk.astype(str).str.strip(),
                "PartyShortRaw": party_short,
                "PartyLongRaw": party_long,
                "Listenplatz": to_int(listenplatz),
                "PreviouslyElected": df.get("VorpGewaehlt", "")
                .astype(str)
                .str.strip()
                .str.upper()
                .eq("X"),
            }
        )
        out["_mode"] = mode
        out["_row_index"] = df.index
        return out

    res = pd.concat([build(main, "main"), build(verkn, "verkn")], ignore_index=True)
    return res


def extract_person_fields(kand: pd.DataFrame, year: int) -> pd.DataFrame:
    """
    Normalize kand rows into person fields (for persons.csv).
    We'll later deduplicate by composite key.
    """
    k = kand.copy()
    k["Year"] = year

    # 2025 has Rufname; ignore for now
    cols = [
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
    ]

    out = pd.DataFrame({c: k[c] if c in k.columns else None for c in cols})
    out["YearSeen"] = year
    out["key"] = person_key(out)
    return out


def pick_best_person_record(group: pd.DataFrame) -> pd.Series:
    """
    Combine multiple records for the same person key:
    take last non-empty for each field (prefers later year if concatenated).
    """
    def last_non_empty(s: pd.Series):
        s2 = s.dropna().astype(str).map(lambda x: x.strip())
        s2 = s2[s2 != ""]
        return s2.iloc[-1] if len(s2) else None

    fields = [
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
    ]
    row = {f: last_non_empty(group[f]) if f in group.columns else None for f in fields}
    row["key"] = group["key"].iloc[0]
    return pd.Series(row)


def main():
    # ---------------------------------------------------------------
    # Load all needed sources
    # ---------------------------------------------------------------
    print("🧭 Loading kand files ...")
    k21 = load_csv(KAND_2021)
    k25 = load_csv(KAND_2025)

    y21 = int(extract_year_from_wahltag(k21, 2021).iloc[0])
    y25 = int(extract_year_from_wahltag(k25, 2025).iloc[0])

    print(f"  kand_2021 detected year: {y21}")
    print(f"  kand_2025 detected year: {y25}")

    party_map = load_csv(PARTY_MAP_CSV)
    short_map, long_map, short_grp, long_grp = build_party_lookup(party_map)

    state_map = load_csv(STATE_MAP_CSV)
    if not {"GebietLandAbk", "StateID"}.issubset(state_map.columns):
        raise KeyError("state_id_mapping.csv must have GebietLandAbk and StateID")
    state_lookup = dict(
        zip(
            state_map["GebietLandAbk"].astype(str).str.strip(),
            to_int(state_map["StateID"]).astype(int),
        )
    )

    const21 = load_csv(CONST_2021)
    const25 = load_csv(CONST_2025)
    const21["Year"] = y21
    const25["Year"] = y25
    const_all = pd.concat([const21, const25], ignore_index=True)
    const_all["Number"] = to_int(const_all["Number"])
    const_all["ConstituencyID"] = to_int(const_all["ConstituencyID"])

    party_lists = load_csv(PARTY_LISTS_CSV)
    party_lists["PartyListID"] = to_int(party_lists["PartyListID"])
    party_lists["Year"] = to_int(party_lists["Year"])
    party_lists["StateID"] = to_int(party_lists["StateID"])
    party_lists["PartyID"] = to_int(party_lists["PartyID"])

    # ---------------------------------------------------------------
    # Build/Update persons.csv
    # ---------------------------------------------------------------
    print("\n🧩 Rebuilding persons from kand (dedupe by composite key) ...")
    p21 = extract_person_fields(k21, y21)
    p25 = extract_person_fields(k25, y25)
    persons_all = pd.concat([p21, p25], ignore_index=True)

    # Merge person records by key
    persons_new = (
        persons_all.groupby("key", as_index=False)
        .apply(pick_best_person_record)
        .reset_index(drop=True)
    )

    # Load existing persons (to keep PersonID stable)
    if PERSONS_CSV.exists():
        persons_old = load_csv(PERSONS_CSV)
        if "key" not in persons_old.columns:
            persons_old["key"] = person_key(persons_old)
    else:
        persons_old = pd.DataFrame(columns=["PersonID", "key"])

    persons_old["PersonID"] = to_int(persons_old.get("PersonID", pd.Series([])))

    # Map existing IDs by key
    key_to_id = dict(
        zip(persons_old["key"].astype(str), persons_old["PersonID"].dropna().astype(int))
    )
    max_id = int(persons_old["PersonID"].max()) if len(persons_old) else 0

    persons_new["PersonID"] = persons_new["key"].map(key_to_id)
    missing_id = persons_new["PersonID"].isna()
    n_new = int(missing_id.sum())
    if n_new:
        persons_new.loc[missing_id, "PersonID"] = range(max_id + 1, max_id + 1 + n_new)

    persons_new["PersonID"] = persons_new["PersonID"].astype(int)

    # Final persons columns
    persons_out_cols = [
        "PersonID",
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
    ]
    persons_out = persons_new[persons_out_cols].sort_values("PersonID")
    persons_out.to_csv(OUT_PERSONS, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved → {OUT_PERSONS.name} ({len(persons_out)} persons, +{n_new} new)")

    # For attaching PersonID back to kand rows we need key per kand row
    # Build a lookup dataframe: key -> PersonID
    pid_lookup = persons_new[["key", "PersonID"]].copy()

    # ---------------------------------------------------------------
    # Rebuild direct_candidacy from kand
    # ---------------------------------------------------------------
    print("\n🗳 Rebuilding direct_candidacy from kand ...")

    # Attach person keys onto kand rows (same fields exist in kand)
    def attach_personid(kand: pd.DataFrame) -> pd.DataFrame:
        tmp = kand.copy()
        # build a persons-like view for key
        tmp_p = pd.DataFrame(
            {
                "Nachname": tmp.get("Nachname"),
                "Vornamen": tmp.get("Vornamen"),
                "Geschlecht": tmp.get("Geschlecht"),
                "Geburtsjahr": tmp.get("Geburtsjahr"),
            }
        )
        tmp["key"] = person_key(tmp_p)
        tmp = tmp.merge(pid_lookup, on="key", how="left")
        return tmp

    k21_pid = attach_personid(k21)
    k25_pid = attach_personid(k25)

    direct_21 = extract_direct_rows(k21_pid, y21)
    direct_25 = extract_direct_rows(k25_pid, y25)
    direct_raw = pd.concat([direct_21, direct_25], ignore_index=True)

    # Attach PersonID from source row index
    # We kept _row_index to join back
    # Build a map: (year, row_index) -> PersonID
    map21 = pd.DataFrame({"_row_index": k21_pid.index, "PersonID": k21_pid["PersonID"]})
    map21["Year"] = y21
    map25 = pd.DataFrame({"_row_index": k25_pid.index, "PersonID": k25_pid["PersonID"]})
    map25["Year"] = y25
    row_pid = pd.concat([map21, map25], ignore_index=True)

    direct_raw = direct_raw.merge(row_pid, on=["Year", "_row_index"], how="left")

    # Map WahlkreisNumber -> ConstituencyID
    direct_raw = direct_raw.merge(
        const_all[["Year", "Number", "ConstituencyID"]],
        left_on=["Year", "WahlkreisNumber"],
        right_on=["Year", "Number"],
        how="left",
    )

    # PartyID mapping + report unmapped/ambiguous
    direct_raw["PartyID_mapped"] = direct_raw.apply(
        lambda r: map_party_id(
            int(r["Year"]),
            r.get("PartyShortRaw"),
            r.get("PartyLongRaw"),
            short_map,
            long_map,
        ),
        axis=1,
    )

    unmapped_direct = direct_raw[direct_raw["PartyID_mapped"].isna()][
        ["Year", "PartyShortRaw", "PartyLongRaw"]
    ].drop_duplicates()

    if len(unmapped_direct):
        print("\n⚠ Unmapped parties in direct_candidacy (needs manual mapping):")
        print(unmapped_direct.to_string(index=False))

    direct = direct_raw.rename(columns={"PartyID_mapped": "PartyID"})[
        ["PersonID", "Year", "ConstituencyID", "PreviouslyElected", "PartyID"]
    ].copy()

    # Drop missing essential keys
    direct = direct.dropna(subset=["PersonID", "Year", "ConstituencyID", "PartyID"])
    direct["Year"] = to_int(direct["Year"])
    direct["ConstituencyID"] = to_int(direct["ConstituencyID"])
    direct["PartyID"] = to_int(direct["PartyID"])
    direct["PreviouslyElected"] = direct["PreviouslyElected"].astype(bool)

    # Deduplicate: one record per person per constituency per year
    direct = (
        direct.sort_values(["Year", "ConstituencyID", "PartyID", "PersonID"])
        .drop_duplicates(subset=["Year", "ConstituencyID", "PersonID"], keep="last")
        .reset_index(drop=True)
    )

    # Preserve Erststimmen from existing direct_candidacy.csv if available
    if DIRECT_CSV.exists():
        direct_old = load_csv(DIRECT_CSV)
        direct_old["Year"] = to_int(direct_old["Year"])
        direct_old["ConstituencyID"] = to_int(direct_old["ConstituencyID"])
        direct_old["PartyID"] = to_int(direct_old["PartyID"])
        direct_old["PersonID"] = to_int(direct_old["PersonID"])
        direct_old["Erststimmen"] = pd.to_numeric(
            direct_old.get("Erststimmen"), errors="coerce"
        )

        direct = direct.merge(
            direct_old[["PersonID", "Year", "ConstituencyID", "PartyID", "Erststimmen"]],
            on=["PersonID", "Year", "ConstituencyID", "PartyID"],
            how="left",
        )
    else:
        direct["Erststimmen"] = pd.NA

    direct_out = direct[
        ["PersonID", "Year", "ConstituencyID", "Erststimmen", "PreviouslyElected", "PartyID"]
    ].copy()

    direct_out.to_csv(OUT_DIRECT, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved → {OUT_DIRECT.name} ({len(direct_out)} rows)")

    # ---------------------------------------------------------------
    # Rebuild party_list_candidacy from kand
    # ---------------------------------------------------------------
    print("\n📜 Rebuilding party_list_candidacy from kand ...")

    list_21 = extract_list_rows(k21_pid, y21)
    list_25 = extract_list_rows(k25_pid, y25)
    list_raw = pd.concat([list_21, list_25], ignore_index=True)

    list_raw = list_raw.merge(row_pid, on=["Year", "_row_index"], how="left")

    # StateID from abbreviation
    list_raw["StateID"] = list_raw["StateAbk"].map(state_lookup)

    unmapped_states = list_raw[list_raw["StateID"].isna()][["Year", "StateAbk"]].drop_duplicates()
    if len(unmapped_states):
        print("\n⚠ Unmapped StateAbk in list candidacy (check state_id_mapping.csv):")
        print(unmapped_states.to_string(index=False))

    list_raw["PartyID_mapped"] = list_raw.apply(
        lambda r: map_party_id(
            int(r["Year"]),
            r.get("PartyShortRaw"),
            r.get("PartyLongRaw"),
            short_map,
            long_map,
        ),
        axis=1,
    )

    unmapped_list = list_raw[list_raw["PartyID_mapped"].isna()][
        ["Year", "PartyShortRaw", "PartyLongRaw"]
    ].drop_duplicates()
    if len(unmapped_list):
        print("\n⚠ Unmapped parties in party_list_candidacy (needs manual mapping):")
        print(unmapped_list.to_string(index=False))

    list_raw["PartyID"] = to_int(list_raw["PartyID_mapped"])
    list_raw["Year"] = to_int(list_raw["Year"])
    list_raw["StateID"] = to_int(list_raw["StateID"])
    list_raw["Listenplatz"] = to_int(list_raw["Listenplatz"])

    # Map PartyListID via party_lists
    plc = list_raw.merge(
        party_lists[["PartyListID", "Year", "StateID", "PartyID"]],
        on=["Year", "StateID", "PartyID"],
        how="left",
    )

    missing_partylist = plc[plc["PartyListID"].isna()][
        ["Year", "StateID", "PartyID", "PartyShortRaw", "PartyLongRaw"]
    ].drop_duplicates()

    if len(missing_partylist):
        print("\n⚠ Missing PartyListID for these (Year,StateID,PartyID):")
        print(missing_partylist.to_string(index=False))

    plc_out = plc.dropna(subset=["PersonID", "Listenplatz"]).copy()
    # keep PartyListID even if NA; we want correct counts and a list to fix mapping
    missing_partylist_rows = plc_out["PartyListID"].isna().sum()
    print(f"⚠ party_list_candidacy rows with missing PartyListID: {int(missing_partylist_rows):,}")
    plc_out["PartyListID"] = to_int(plc_out["PartyListID"])
    plc_out["PreviouslyElected"] = plc_out["PreviouslyElected"].astype(bool)

    plc_out = (
        plc_out[["PersonID", "PartyListID", "Listenplatz", "PreviouslyElected"]]
        .sort_values(["PartyListID", "Listenplatz", "PersonID"])
        .drop_duplicates(subset=["PersonID", "PartyListID"], keep="last")
        .reset_index(drop=True)
    )

    plc_out.to_csv(OUT_PLC, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved → {OUT_PLC.name} ({len(plc_out)} rows)")

    print("\n✅ Done.\n"
          f"- persons: {OUT_PERSONS}\n"
          f"- direct_candidacy: {OUT_DIRECT}\n"
          f"- party_list_candidacy: {OUT_PLC}\n")
    
    print("\n📊 Sanity checks (expected totals)")
    print("  Expected direct total: 6025")
    print("  Expected list total  : 8627")
    print(f"  Produced direct rows : {len(direct_out):,}")
    print(f"  Produced list rows   : {len(plc_out):,}")


if __name__ == "__main__":
    try:
        main()
    except FileNotFoundError as e:
        print(f"❌ Missing file: {e.filename}")
    except KeyError as e:
        print(f"❌ Missing expected column: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {type(e).__name__}: {e}")