"""Explicit annotation extraction. No scale, geometry-derived values or implicit units."""

import re

NUMBER = r"(?:\d+(?:[.,]\d+)?|[.,]\d+)"
PATTERN = re.compile(
    r"(?<![\w.,])(?P<value>"
    + NUMBER
    + r")\s*(?P<unit>mm|cm|km|m|ft|in)(?P<square>\s*(?:²|\^2|2))?(?!\w)",
    re.I,
)


def extract(text):
    result = []
    for match in PATTERN.finditer(text):
        if re.search(r"\d\s+$", text[: match.start()]):
            continue  # Ambiguous grouped number: never silently extract only its final digits.
        # Leading decimals and OCR truncations need inspection; don't silently complete them.
        raw = match.group("value")
        unit = match.group("unit").lower()
        area = bool(match.group("square"))
        result.append(
            {
                "source_text": text,
                "matched_text": match.group(0),
                "value": float(raw.replace(",", ".")),
                "unit": unit + ("²" if area else ""),
                "dimension": "area" if area else "linear",
                "partial_number": raw.startswith((".", ",")),
                "source": "drawing_annotation",
                "character_span": list(match.span()),
            }
        )
    return result


def resolve(candidate, answers):
    role = answers["property"]["choice"]
    reasons = []
    if candidate["partial_number"]:
        reasons.append("Possible truncated OCR number")
    if answers["transcription_correct"]["noul"] < 0.95:
        reasons.append("Value/unit transcription needs review")
    if answers["belongs_to_target"]["noul"] < 0.95:
        reasons.append("Target association uncertain")
    if answers["property"]["confidence"] < 0.90:
        reasons.append("Property meaning uncertain")
    if role == "unassigned":
        reasons.append("No explicit property meaning")
    if (role == "area") != (candidate["dimension"] == "area"):
        reasons.append("Property conflicts with explicit unit")
    return {
        "property": role if not reasons else None,
        "status": "supported_candidate" if not reasons else "needs_review",
        "review_reasons": reasons,
        "verified_by_human": False,
    }
