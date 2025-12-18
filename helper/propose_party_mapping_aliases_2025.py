import re
import unicodedata
from pathlib import Path

import pandas as pd

DATA_DIR = Path("data")
MAP_IN = DATA_DIR / "old2.0/party_id_mapping.csv"
MAP_OUT = DATA_DIR / "old2.0/party_id_mapping_updated.csv"

YEAR = 2025

UNMAPPED = [
    "Die Gerechtigkeitspartei – Team Todenhöfer",
    "Christlich Demokratische Union Deutschlands in Niedersachsen",
    "FREIE WÄHLER Niedersachsen",
    "Ökologisch-Demokratische Partei - Die Naturschutzpartei",
    "Ökologisch-Demokratische Partei / Familie und Umwelt",
]


def norm(s: str) -> str:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = str(s).strip()
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s+", " ", s)
    return s.casefold()


def main():
    pm = pd.read_csv(MAP_IN, sep=";", encoding="utf-8-sig")
    pm.columns = [c.strip() for c in pm.columns]
    pm["Year"] = pd.to_numeric(pm["Year"], errors="coerce").astype("Int64")
    pm["PartyID"] = pd.to_numeric(pm["PartyID"], errors="coerce").astype("Int64")

    pm_yr = pm[pm["Year"] == YEAR].copy()
    pm_yr["NormShort"] = pm_yr["ShortName"].map(norm)
    pm_yr["NormLong"] = pm_yr["LongName"].map(norm)

    # Helper: unique PartyID by exact short/long match
    def unique_pid_exact(name: str):
        n = norm(name)
        ids = set(
            pm_yr.loc[(pm_yr["NormShort"] == n) | (pm_yr["NormLong"] == n), "PartyID"]
            .dropna()
            .astype(int)
            .tolist()
        )
        if len(ids) == 1:
            return list(ids)[0]
        if len(ids) > 1:
            print(f"⚠️ Ambiguous exact match for '{name}' → {sorted(ids)}")
        return None

    # Helper: unique PartyID by a safe "contains" rule (to handle regional variants)
    def unique_pid_contains(substr_norm: str):
        ids = set(
            pm_yr.loc[
                pm_yr["NormLong"].str.contains(substr_norm, na=False)
                | pm_yr["NormShort"].str.contains(substr_norm, na=False),
                "PartyID",
            ]
            .dropna()
            .astype(int)
            .tolist()
        )
        if len(ids) == 1:
            return list(ids)[0]
        if len(ids) > 1:
            return None
        return None

    alias_rows = []
    manual = []

    for name in UNMAPPED:
        pid = unique_pid_exact(name)

        # If not exact, try safe rules
        if pid is None:
            n = norm(name)

            # CDU regional variants
            if "christlich demokratische union" in n:
                pid = unique_pid_exact("CDU") or unique_pid_contains("christlich demokratische union")

            # FREIE WÄHLER regional variants
            elif "freie wähler" in n or "freie wahler" in n:
                pid = unique_pid_contains("freie wähler") or unique_pid_contains("freie wahler")

            # ÖDP variants
            elif "ökologisch-demokratische partei" in n or "okologisch-demokratische partei" in n:
                pid = unique_pid_contains("ödp") or unique_pid_contains("ökologisch")

            # Team Todenhöfer variants
            elif "todenhöfer" in n or "todenhofer" in n:
                pid = unique_pid_contains("todenhöfer") or unique_pid_contains("todenhofer")

        if pid is None:
            manual.append(name)
            continue

        # Create an alias row: use the exact encountered name as ShortName,
        # and keep the same string as LongName (or you can keep canonical long name)
        alias_rows.append(
            {
                "Year": YEAR,
                "ShortName": name,
                "LongName": name,
                "PartyID": pid,
            }
        )

    if manual:
        print("\n❌ Could not map these safely (manual):")
        for x in manual:
            print(f"  - {x}")

    if not alias_rows:
        print("\n✅ No alias rows to add.")
        return

    alias_df = pd.DataFrame(alias_rows)

    # Avoid duplicates if already present
    pm_merge_check = pm.copy()
    pm_merge_check["NormShort"] = pm_merge_check["ShortName"].map(norm)
    alias_df["NormShort"] = alias_df["ShortName"].map(norm)

    already = set(
        pm_merge_check.loc[
            (pm_merge_check["Year"] == YEAR)
            & (pm_merge_check["NormShort"].isin(alias_df["NormShort"])),
            "NormShort",
        ]
        .tolist()
    )
    alias_df = alias_df[~alias_df["NormShort"].isin(already)].drop(columns=["NormShort"])

    if alias_df.empty:
        print("\n✅ All proposed aliases already exist in mapping.")
        return

    updated = pd.concat([pm, alias_df], ignore_index=True)
    updated.to_csv(MAP_OUT, sep=";", index=False, encoding="utf-8-sig")

    print("\n✅ Proposed alias rows added:")
    print(alias_df.to_string(index=False))
    print(f"\n💾 Wrote updated mapping → {MAP_OUT}")


if __name__ == "__main__":
    main()