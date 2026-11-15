# Junction construction drawings

About 14,000 construction drawings (PDF, DWG, DXF, IFC, SVG, PNG and JPEG scans) from Europe and the US,
in about 30 languages, with about 120,000 quantity-takeoff questions for roughly 40% of them.
For non-commercial use in the Junction challenge.

```
data/<source>/<file>       the drawings
data/<source>/LICENSE.md   licence and credit for every file in that folder
questions.jsonl            {"path", "question", "answer", "unit", "type"}
```

Files with the same name and a different extension are the same drawing in another format.
`ifc_models` floor plans `<model>_<level>.pdf` were rendered from the model `<model>.ifc`.

## Questions

```json
{
    "path": "data/swiss_dwellings/site3387_bldg5238_floor23498.pdf",
    "question": "How many apartments (residential units) are shown on this floor plan?",
    "answer": 2,
    "unit": "count",
    "type": "count"
}
```

`type` is count, area, length, volume, text or other. Scoring: counts must be exact; areas, lengths and
volumes within 2%; text answers are free-form.

## Sources

| source          | what                                                                                  | licence           |
| --------------- | ------------------------------------------------------------------------------------- | ----------------- |
| cubicasa5k      | Finnish real-estate floor plans                                                       | CC BY-NC-SA 4.0   |
| swiss_dwellings | Swiss apartment floors drawn from published geometry (PDF, DXF, PNG)                  | CC BY 4.0         |
| opening_design  | real drawing sets and CAD files of a US architecture practice (original folders kept) | CC BY-SA 4.0, MIT |
| ifc_models      | open IFC building models and floor plans rendered from them                           | per file          |
| ifc_bench       | IFC models with the IFC-Bench v2 questions                                            | per file          |
| habs            | US historic measured drawings, Library of Congress                                    | public domain     |
| finna           | Helsinki City Archives and Architecture & Design Museum drawings                      | CC BY 4.0         |
| europeana       | drawings from European museums and archives                                           | per file          |
| wikimedia       | European, UK and US floor plans from Wikimedia Commons                                | per file          |

## Licences

The repository's root submission review license does not apply to this supplied dataset,
including `questions.jsonl`. Source-specific license and credit files under `data/` are Git-ignored
and are not shipped in the repository. Before redistributing questions or drawings, verify the
challenge terms and include the applicable credits and licenses, or exclude the data from that copy.
See [third-party notices](../../THIRD_PARTY_NOTICES.md#challenge-data-and-research).

Every file keeps its own licence, listed with its credit in `data/<source>/LICENSE.md`. Keep the credit
when you show or share a drawing. NonCommercial (NC) files are for non-commercial use only. Adaptations of
ShareAlike (SA) files must use the same licence. NoDerivatives (ND) files must stay unchanged.
Questions inherit the licence of the drawing they ask about.
