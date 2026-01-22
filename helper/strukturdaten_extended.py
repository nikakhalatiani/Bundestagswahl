import csv
import os
import re


MONTHS = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
]

IGNORE_HEADERS = {"Land", "Wahlkreis-Nr.", "Wahlkreis-Name", "Fußnoten"}

SPECIAL_METRICS = [
    {
        "key": "foreigner_pct",
        "label": "Foreigners",
        "unit": "%",
        "keywords": ["Bevölkerung", "Ausländer", "%"],
    },
    {
        "key": "disposable_income",
        "label": "Disposable income",
        "unit": "EUR per resident",
        "keywords": ["Verfügbares Einkommen"],
    },
    {
        "key": "gdp_per_capita",
        "label": "GDP per capita",
        "unit": "EUR per resident",
        "keywords": ["Bruttoinlandsprodukt"],
    },
    {
        "key": "population_density",
        "label": "Population density",
        "unit": "residents per km²",
        "keywords": ["Bevölkerungsdichte"],
    },
    {
        "key": "population_total",
        "label": "Population total",
        "unit": "thousands",
        "keywords": ["Bevölkerung", "Insgesamt", "in 1000"],
    },
    {
        "key": "unemployment_rate_total",
        "label": "Unemployment rate",
        "unit": "%",
        "keywords": ["Arbeitslosenquote", "insgesamt"],
    },
]

UNIT_OVERRIDES = {
    "Anzahl": "count",
    "Betreuungsquote": "coverage rate",
    "EUR je EW": "EUR per resident",
    "EW je km²": "residents per km²",
    "in 1000": "thousands",
    "je 1000 EW": "per 1,000 residents",
    "je EW": "per resident",
    "je Wohnung": "per dwelling",
    "km²": "km²",
    "%": "%",
}

LABEL_OVERRIDES = {
    "gemeinden_anzahl": "Municipalities",
    "flache_km": "Area",
    "population_total": "Population total",
    "bevolkerung_deutsche_in_1000": "Population (German)",
    "foreigner_pct": "Foreigners",
    "population_density": "Population density",
    "zu_bzw_abnahme_der_bevolkerung_geburtensaldo_je_1000_ew": "Population change: births balance",
    "zu_bzw_abnahme_der_bevolkerung_wanderungssaldo_je_1000_ew": "Population change: migration balance",
    "alter_von_bis_jahren_unter_18": "Age share under 18",
    "alter_von_bis_jahren_18_24": "Age share 18-24",
    "alter_von_bis_jahren_25_34": "Age share 25-34",
    "alter_von_bis_jahren_35_59": "Age share 35-59",
    "alter_von_bis_jahren_60_74": "Age share 60-74",
    "alter_von_bis_jahren_75_und_mehr": "Age share 75+",
    "bodenflache_nach_art_der_tatsachlichen_nutzung_siedlung_und_verkehr": "Land use: settlement & transport",
    "bodenflache_nach_art_der_tatsachlichen_nutzung_vegetation_und_gewasser": "Land use: vegetation & water",
    "fertiggestellte_wohnungen_je_1000_ew": "New dwellings",
    "bestand_an_wohnungen_insgesamt_je_1000_ew": "Housing stock",
    "wohnflache_je_wohnung": "Living space per dwelling",
    "wohnflache_je_ew": "Living space per resident",
    "pkw_bestand_pkw_insgesamt_je_1000_ew": "Passenger cars (total)",
    "pkw_bestand_pkw_mit_elektro_oder_hybrid_antrieb": "Passenger cars (electric/hybrid)",
    "unternehmensregister_unternehmen_insgesamt_je_1000_ew": "Companies (total)",
    "unternehmensregister_handwerksunternehmen_je_1000_ew": "Craft businesses",
    "schulabganger_innen_beruflicher_schulen": "Graduates: vocational schools",
    "schulabganger_innen_allgemeinbildender_schulen_insgesamt_ohne_externe_je_1000_ew": "Graduates: general schools (total)",
    "schulabganger_innen_allgemeinbildender_schulen_ohne_hauptschulabschluss": "Graduates: no lower secondary certificate",
    "schulabganger_innen_allgemeinbildender_schulen_mit_hauptschulabschluss": "Graduates: lower secondary certificate",
    "schulabganger_innen_allgemeinbildender_schulen_mit_mittlerem_schulabschluss": "Graduates: intermediate certificate",
    "schulabganger_innen_allgemeinblldender_schulen_mit_allgemeiner_und_fachhochschulreife": "Graduates: university entrance qualification",
    "kindertagesbetreuung_betreute_kinder_unter_3_jahre_betreuungsquote": "Childcare coverage: under 3",
    "kindertagesbetreuung_betreute_kinder_3_bis_unter_6_jahre_betreuungsquote": "Childcare coverage: 3-6",
    "disposable_income": "Disposable income",
    "gdp_per_capita": "GDP per capita",
    "sozialversicherungspflichtig_beschaftigte_insgesamt_je_1000_ew": "Employees (social insurance)",
    "sozialversicherungspflichtig_beschaftigte_land_und_forstwirtschaft_fischerei": "Employment: agriculture & forestry",
    "sozialversicherungspflichtig_beschaftigte_produzierendes_gewerbe": "Employment: manufacturing",
    "sozialversicherungspflichtig_beschaftigte_handel_gastgewerbe_verkehr": "Employment: trade, hospitality & transport",
    "sozialversicherungspflichtig_beschaftigte_offentliche_und_private_dienstleister": "Employment: public & private services",
    "sozialversicherungspflichtig_beschaftigte_ubrige_dienstleister_und_ohne_angabe": "Employment: other services/unknown",
    "empfanger_innen_von_leistungen_nach_sgb_ii_insgesamt_je_1000_ew": "Benefit recipients (SGB II)",
    "empfanger_innen_von_leistungen_nach_sgb_ii_nicht_erwerbsfahige_hilfebedurftige": "Benefit recipients: not employable",
    "empfanger_innen_von_leistungen_nach_sgb_ii_auslander_innen": "Benefit recipients: foreigners",
    "unemployment_rate_total": "Unemployment rate",
    "arbeitslosenquote_manner": "Unemployment rate (men)",
    "arbeitslosenquote_frauen": "Unemployment rate (women)",
    "arbeitslosenquote_15_bis_24_jahre": "Unemployment rate (15-24)",
    "arbeitslosenquote_55_bis_64_jahre": "Unemployment rate (55-64)",
}


def clean_number(value: str) -> str:
    if value is None:
        return ""
    raw = value.strip()
    if raw == "":
        return ""
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    else:
        raw = raw.replace(",", ".")
    return raw


def normalize_label(text: str) -> str:
    label = text
    label = re.sub(r"\bam\s+\d{2}\.\d{2}\.\d{4}\b", "", label)
    label = re.sub(r"\b(19|20)\d{2}\b", "", label)
    for month in MONTHS:
        label = re.sub(rf"\b{month}\b", "", label, flags=re.IGNORECASE)
    label = re.sub(r"\s+", " ", label)
    return label.strip(" -")


def extract_unit(text: str) -> str:
    match = re.search(r"\(([^()]*)\)\s*$", text)
    return match.group(1).strip() if match else ""


def normalize_key(text: str) -> str:
    key = text.upper()
    key = key.replace("Ü", "U").replace("Ö", "O").replace("Ä", "A").replace("ß", "SS")
    key = re.sub(r"[^A-Z0-9]+", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    return key.lower()


def find_special_metric(header: str):
    for metric in SPECIAL_METRICS:
        if all(keyword in header for keyword in metric["keywords"]):
            return metric
    return None


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    inputs = [
        (2021, os.path.join(project_root, "data", "rawData", "btw2021_strukturdaten.csv")),
        (2025, os.path.join(project_root, "data", "rawData", "btw2025_strukturdaten.csv")),
    ]

    output_file = os.path.join(project_root, "data", "strukturdaten.csv")

    records = []
    metric_defs = {}

    for year, input_file in inputs:
        if not os.path.exists(input_file):
            print(f"⚠️ File not found: {input_file}")
            continue

        with open(input_file, mode="r", encoding="utf-8-sig", newline="") as f_in:
            reader = csv.DictReader(f_in, delimiter=";")
            headers = reader.fieldnames or []

            headers_to_use = [h for h in headers if h not in IGNORE_HEADERS]

            for row in reader:
                wk_val = row.get("Wahlkreis-Nr.")
                if not wk_val:
                    continue
                wk_digits = re.sub(r"[^\d]", "", wk_val)
                if wk_digits == "":
                    continue
                wk_id = int(wk_digits)
                if wk_id > 299:
                    continue

                for header in headers_to_use:
                    raw_value = row.get(header, "")
                    value = clean_number(raw_value)
                    if value == "":
                        continue

                    special = find_special_metric(header)
                    raw_unit = extract_unit(header)
                    display_unit = UNIT_OVERRIDES.get(raw_unit, raw_unit)
                    base_label = normalize_label(header)
                    if raw_unit:
                        base_label = re.sub(r"\s*\([^()]*\)\s*$", "", base_label).strip()

                    if special:
                        metric_key = special["key"]
                        metric_label = special["label"]
                        metric_unit = special["unit"]
                    else:
                        key_source = f"{base_label} {raw_unit}".strip()
                        metric_key = normalize_key(key_source)
                        metric_label = base_label
                        metric_unit = display_unit

                    metric_label = LABEL_OVERRIDES.get(metric_key, metric_label)

                    metric_defs.setdefault(metric_key, {"label": metric_label, "unit": metric_unit})

                    records.append({
                        "Year": year,
                        "ConstituencyNumber": wk_id,
                        "MetricKey": metric_key,
                        "MetricLabel": metric_label,
                        "MetricUnit": metric_unit,
                        "Value": value,
                    })

    if not records:
        print("⚠️ No records generated.")
        return

    with open(output_file, mode="w", encoding="utf-8", newline="") as f_out:
        fieldnames = ["Year", "ConstituencyNumber", "MetricKey", "MetricLabel", "MetricUnit", "Value"]
        writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        writer.writerows(records)

    print(f"✅ Wrote {len(records)} rows to {output_file}")
    print(f"✅ Metrics extracted: {len(metric_defs)}")


if __name__ == "__main__":
    main()
