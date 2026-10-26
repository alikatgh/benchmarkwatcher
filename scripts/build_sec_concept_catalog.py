#!/usr/bin/env python3
"""Reproduce the checked-in financial catalog from its official metadata files.

Download the schema and label URLs recorded in sec_concepts.json separately.
This offline builder verifies their pinned hashes; it never downloads company
facts or silently changes taxonomy versions, financial types or the core set.
"""
import argparse
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts import import_sec_library as sec

MAX_METADATA_BYTES = 20 * 1024 * 1024
XLINK = "{http://www.w3.org/1999/xlink}"
LINK = "{http://www.xbrl.org/2003/linkbase}"
INSTANCE = "{http://www.xbrl.org/2003/instance}"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
TYPES = {"xbrli:monetaryItemType": "USD", "xbrli:sharesItemType": "shares",
         "dtr-types:perShareItemType": "USD/shares"}


def build_catalog(schema: Path, labels: Path) -> dict:
    metadata = sec.CATALOG["sources"]["fasb2026"]
    for path, key in ((Path(schema), "schema_sha256"), (Path(labels), "labels_sha256")):
        if path.stat().st_size > MAX_METADATA_BYTES:
            raise sec.SECImportError("Official taxonomy metadata exceeds the bounded size limit")
        if hashlib.sha256(path.read_bytes()).hexdigest() != metadata[key]:
            raise sec.SECImportError("Official taxonomy metadata hash differs from the pinned catalog")
    names = {}
    for link in ET.parse(labels).getroot().findall(LINK + "labelLink"):
        locators = {x.get(XLINK + "label"): x.get(XLINK + "href", "").split("#")[-1]
                    for x in link.findall(LINK + "loc")}
        resources = {x.get(XLINK + "label"): x.text for x in link.findall(LINK + "label")
                     if x.get(XLINK + "role") == "http://www.xbrl.org/2003/role/label"
                     and x.get(XML_LANG) == "en-US"}
        for arc in link.findall(LINK + "labelArc"):
            target = arc.get(XLINK + "to")
            source = arc.get(XLINK + "from")
            if target in resources and source in locators:
                key, value = locators[source], resources[target]
                if key in names and names[key] != value:
                    raise sec.SECImportError("Official taxonomy contains conflicting standard labels")
                names[key] = value
    concepts = []
    for element in ET.parse(schema).getroot().findall("{http://www.w3.org/2001/XMLSchema}element"):
        data_type = element.get("type")
        if data_type not in TYPES or element.get("abstract") == "true":
            continue
        label, period = names.get(element.get("id")), element.get(INSTANCE + "periodType")
        if not label or period not in ("instant", "duration"):
            raise sec.SECImportError("Financial concept lacks an official label or reporting period")
        concepts.append({"tag": element.get("name"), "name": label, "period_type": period,
                         "data_type": data_type, "unit": TYPES[data_type], "metadata_source": "fasb2026"})
    # Deprecated originals are retained with their separately verified SEC frame
    # metadata. They are not invented or mapped into modern revenue concepts.
    concepts.extend(row for row in sec.CATALOG["concepts"] if row["metadata_source"] != "fasb2026")
    tags = {row["tag"] for row in concepts}
    if any(tag not in tags for tag in sec.CATALOG["core_tags"]):
        raise sec.SECImportError("The reviewed core selection is missing from the verified metadata")
    return {**sec.CATALOG, "concepts": sorted(concepts, key=lambda row: row["tag"])}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        payload = build_catalog(args.schema, args.labels)
        # Refuse an existing output; generated metadata is reviewable before a
        # deliberate replacement of the checked-in catalog.
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
    except (ValueError, OSError, ET.ParseError) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps({"status": "built", "concepts": len(payload["concepts"]), "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
