import pandas as pd
from pathlib import Path

DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"

KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2_new.csv"
CPV_REBUILT = DATA_DIR / "constituency_party_votes_rebuilt.csv"


def load_kerg(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df


def group_key_stats(df: pd.DataFrame, year: int):
    df = df.copy()
    df = df[df["Gebietsart"] == "Wahlkreis"]

    def parse_num_local(s):
        if not isinstance(s, str):
            return s
        s = s.strip()
        if not s:
            return None
        s = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", s)
        s = s.replace(",", ".")
        return s

    df["Anzahl_num"] = pd.to_numeric(
        df["Anzahl"].map(parse_num_local), errors="coerce"
    )

    # only keep entries that actually have votes
    # df = df[df["Anzahl_num"] > 0]

    df["VoteType"] = pd.to_numeric(df["Stimme"], errors="coerce").astype("Int64")
    df["Number"] = (
        df["Gebietsnummer"]
        .astype(str)
        .str.strip()
        .str.lstrip("0")
        .replace({"": None})
    )
    df["Number"] = pd.to_numeric(df["Number"], errors="coerce").astype("Int64")

    mask = df["Gruppenart"].isin(
        ["Partei", "Einzelbewerber", "Einzelbewerber/Wählergruppe"]
    ) 
    df = df[mask].copy()

    uniq = (
        df[["Number", "Gruppenart", "Gruppenname", "VoteType"]]
        .dropna(subset=["Number", "Gruppenname", "VoteType"])
        .drop_duplicates()
    )

    print(
        f"Year {year}: raw KERG rows with votes={len(df)}, "
        f"unique Wahlkreis–Partei/EB/Stimme (votes>0)={len(uniq)}"
    )
    return len(uniq)


def main():
    print("Loading KERG + rebuilt CPV ...")

    k21 = load_kerg(KERG_2021, 2021)
    k25 = load_kerg(KERG_2025, 2025)

    n_kerg_21 = group_key_stats(k21, 2021)
    n_kerg_25 = group_key_stats(k25, 2025)

    # Load rebuilt constituency_party_votes
    cpv = pd.read_csv(CPV_REBUILT, sep=";", encoding="utf-8-sig")
    cpv["Year"] = None
    if "Year" not in cpv.columns:
        print("No Year column in CPV; inferring from BridgeID mapping would be needed.")
    else:
        cpv["Year"] = pd.to_numeric(cpv["Year"], errors="coerce").astype("Int64")
        
    cpv = pd.read_csv(CPV_REBUILT, sep=";", encoding="utf-8-sig")

    # --- Infer Year if missing ----------------------------------------
    if "Year" not in cpv.columns:
        print("No 'Year' column in CPV, inferring from constituency_elections mapping ...")
        elections = pd.read_csv("data/constituency_elections.csv", sep=";", encoding="utf-8-sig")
        year_map = elections[["BridgeID", "Year"]].drop_duplicates()
        cpv = cpv.merge(year_map, on="BridgeID", how="left")
    # ------------------------------------------------------------------

    cpv["Year"] = pd.to_numeric(cpv["Year"], errors="coerce").astype("Int64")

    for year, n_kerg in [(2021, n_kerg_21), (2025, n_kerg_25)]:
        n_cpv = len(cpv[cpv["Year"] == year])
        print(f"Year {year}: CPV rows={n_cpv}, KERG unique={n_kerg}, difference={n_cpv - n_kerg}")


if __name__ == "__main__":
    main()