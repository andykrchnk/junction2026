"""Export private paired geometry and review proposals; no service secrets in HTML."""

import argparse
import json
from pathlib import Path
import shutil

from shapely import wkt
from shapely.ops import unary_union

ROOT = Path(".local/cubicasa-refinement-v2")
DATA = Path(".local/gpu-comparison")


def polygon_parts(shape):
    if shape.geom_type == "Polygon":
        return [shape] if not shape.is_empty else []
    return [p for child in getattr(shape, "geoms", []) for p in polygon_parts(child)]


def feature(record, kind, label=None, identifier=None, review=False):
    shape = wkt.loads(record["geometry_wkt"])
    rings = [shape.exterior, *shape.interiors]
    path = " ".join(
        "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in ring.coords) + " Z"
        for ring in rings
    )
    return {
        "d": path,
        "kind": kind,
        "label": label,
        "id": identifier,
        "review": review,
        "area": shape.area,
        "center": list(shape.representative_point().coords)[0],
        "review_reasons": record.get("review_reasons", []),
        "status": record.get("status", "unverified_model_proposal"),
        "stability_iou": record.get("stability_iou"),
        "class_mean_softmax": record.get("confidence"),
        "semantics_verified": False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    assets = out / "refinement-assets"
    assets.mkdir(exist_ok=True)
    (out / "licenses").mkdir(exist_ok=True)
    comparison = json.loads((ROOT / "instance-comparison.json").read_text())
    samples = {
        s["id"]: s for s in json.loads((DATA / "manifest.json").read_text())["samples"]
    }
    drawings = {}
    for evidence in comparison["drawings"]:
        identifier = evidence["id"]
        sample = samples[identifier]
        shutil.copyfile(sample["raster_path"], assets / (identifier + ".png"))
        shutil.copyfile(
            sample["license"], out / "licenses" / (sample["source"] + ".md")
        )
        directory = ROOT / "adapter" / identifier
        summary = json.loads((directory / "predictions.json").read_text())
        raw = json.loads((directory / "raw.json").read_text())
        shutil.copyfile(
            directory / "predictions.json", assets / (identifier + "-detail.json")
        )
        profiles = {}
        previous = [
            feature(
                p,
                "rooms",
                summary["class_mapping"]["rooms"][p["class_id"]],
                f"P{i + 1:03}",
            )
            for i, p in enumerate(raw["official_room_regions"])
        ]
        profiles["previous"] = {
            "name": "Previous · 2048 class-merged geometry",
            "features": previous,
        }
        separated = [
            feature(
                p,
                "rooms",
                p["model_label"],
                p["instance_id"],
                p["status"] == "needs_review",
            )
            for p in summary["room_instances"]
        ]
        # Union the wall display to remove overlapping rectangles; retain raw pieces in JSON.
        wall_union = unary_union(
            [wkt.loads(p["geometry_wkt"]) for p in summary["wall_polygons"]]
        )
        separated.extend(
            feature({"geometry_wkt": p.wkt}, "walls") for p in polygon_parts(wall_union)
        )
        separated.extend(
            feature(p, "walls", p["class"], review=True)
            for p in summary["review_wall_polygons"]
        )
        for key, review in [
            ("icon_detections", False),
            ("review_icon_detections", True),
        ]:
            for p in summary[key]:
                kind = (
                    "doors"
                    if p["class"] == "Door"
                    else "windows" if p["class"] == "Window" else "fixtures"
                )
                separated.append(feature(p, kind, p["class"], review=review))
        profiles["separated"] = {
            "name": "New · wall-separated regions + review checks",
            "features": separated,
        }
        reference_path = DATA / "cad-ground-truth" / (identifier + ".json")
        if reference_path.exists():
            reference = json.loads(reference_path.read_text())
            if reference["compatible"]:
                profiles["cad"] = {
                    "name": "Registered CAD reference",
                    "features": [
                        feature({"geometry_wkt": p}, "rooms", identifier=f"C{i + 1:03}")
                        for i, p in enumerate(reference["reference_polygons_wkt"])
                    ],
                }
        drawings[identifier] = {
            "width": sample["width"],
            "height": sample["height"],
            "image": "refinement-assets/" + identifier + ".png",
            "license": "licenses/" + sample["source"] + ".md",
            "profiles": profiles,
        }
    rows = []
    for r in comparison["drawings"]:
        if "before" not in r:
            continue
        before, after = r["before"], r["after_default"]
        rows.append(
            f"<tr><td>{r['id']}</td><td>{before['merged_reference_regions']} → {after['merged_reference_regions']}</td><td>{before['matched_iou_05']} → {after['matched_iou_05']} / {after['reference_regions']}</td><td>{r['passes_checks']} + {r['needs_review']} review</td><td>{r['after_all']['union_iou']:.3f} / {after['union_iou']:.3f}</td></tr>"
        )
    page = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CubiCasa refinement v2 — separated regions</title><style>
body{font:16px/1.5 system-ui,sans-serif;color:#192a38;background:#f6f8fa;margin:24px}h1{line-height:1.2}p{max-width:1100px}a{color:#075d96}.notice{border-left:4px solid #146c9e;padding-left:16px}.controls{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;gap:16px;align-items:center;background:white;padding:14px;border:1px solid #cbd6df}select{font:inherit;padding:7px;max-width:100%}.panels{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:20px 0}.pane{min-width:0}.viewport{height:850px;overflow:auto;border:1px solid #cbd6df;background:#e9eef1}.viewport svg{display:block;width:100%;height:auto;max-width:none}.legend{min-height:45px;font-size:14px}.inspector{padding:12px;background:#fff;border:1px solid #cbd6df;white-space:pre-wrap;font:14px/1.5 system-ui,sans-serif}table{border-collapse:collapse;background:white}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}details{margin:16px 0}@media(max-width:850px){.panels{grid-template-columns:1fr}.viewport{height:600px}}
</style><h1>Refinement v2: separate geometry before naming rooms</h1>
<p class="notice"><strong>New default comparison:</strong> previous 2048 geometry on the left; wall-separated proposals on the right. Recognized walls and openings now constrain region boundaries. Raw candidates remain available. Passing the checks does not verify a room or its type; missed walls can still leave merged regions.</p>
<p>Blue proposals pass the current structural checks. Enable <strong>Review proposals</strong> to see flagged regions and structures in dashed orange. Names such as “Garage” are unverified model guesses and are off by default. Click a shape to inspect its status. Six drawings were run; three have compatible CAD reference geometry.</p>
<div class="controls"><label>Drawing <select id="drawing"></select></label><label>Zoom <input id="zoom" type="range" min="100" max="400" step="25" value="100"><span id="zoomLabel">100%</span></label><label><input id="rooms" type="checkbox" checked> Regions</label><label><input id="walls" type="checkbox"> Walls</label><label><input id="doors" type="checkbox"> Doors</label><label><input id="windows" type="checkbox"> Windows</label><label><input id="fixtures" type="checkbox"> Fixtures</label><label><input id="review" type="checkbox"> Review proposals</label><label><input id="ids" type="checkbox"> Region IDs</label><label><input id="guesses" type="checkbox"> Model name guesses</label><label><input id="source" type="checkbox" checked> Original</label></div>
<div class="panels"><section class="pane"><select id="left"></select><p class="legend" id="leftLegend"></p><div id="leftView" class="viewport"></div></section><section class="pane"><select id="right"></select><p class="legend" id="rightLegend"></p><div id="rightView" class="viewport"></div></section></div>
<pre id="inspector" class="inspector">Click a region to inspect its review reasons and unverified model label.</pre><p id="credit"></p>
<h2>Region matching, including the remaining failures</h2><table><tr><th>Drawing</th><th>Merged CAD-region proposals: before → default</th><th>Matched CAD regions: before → default</th><th>New candidates</th><th>Union IoU: all / default</th></tr>__ROWS__</table>
<p>The complex drawing still has merged CAD regions, including proposals that pass the checks. This is an improvement in matching and wall consistency, not a guarantee of correct room instances. Hiding review cases lowers coverage and may hide legitimate spaces; enable them to inspect everything. “Merged” means a proposal covers over 50% of at least two CAD regions. CAD zones may include open-plan subdivisions, so this is not a definitive physical-room count.</p>
<details><summary>What changed and how review works</summary><p>First remove semantic class boundaries by combining the candidate footprint. Cut it using model wall/railing probabilities plus the supported structural wall and opening polygons. Extract connected region instances, preserving holes and source coordinates, then subtract the vector barriers again so the output cannot overlap those accepted barriers. Assign model class scores afterwards; never merge regions by class.</p><p>Review checks flag topology changes across wall thresholds 0.35 and 0.65, multiple substantial lobes connected through a narrow area, and elongated internal barriers. These are heuristic checks, not calibrated probabilities. Some ambiguous geometry will pass them. Weak dense-head agreement is also recorded for structures. Walls are displayed as a union to remove duplicate overlapping rectangles; raw pieces remain in the JSON. Predicted names and supported fixture categories are retained without claiming they are verified.</p><p>Comparison uses the same 2048 forward output for before/after. One-to-one maximum-cardinality matching requires polygon IoU ≥0.5. A minimum area of 0.01% of the page is applied to both prediction sets and CAD references, with exclusions recorded. References are used only in evaluation, never in reconstruction. Three paired Swiss DXFs passed the previous registration gate; other drawings have no geometry accuracy claim.</p></details>
<p>The API also exposes this experimental mode as <code>model=cubicasa-detail</code>, with separate review fields. CubiCasa remains the unchanged default. Requests still require the private backend key; no key is embedded here. <a href="instance-comparison.json">Measurements and scope</a> · <a href="instance-comparison.csv">CSV</a> · <a href="instance-reproduction.txt">Reproduction</a> · <a href="refinement-v1.html">Previous refinement preview</a> · <a href="report.html">Original model comparison</a></p>
<script>const DATA=__DATA__;
const $=id=>document.getElementById(id),colors={rooms:'#0086cf',walls:'#43576a',doors:'#139552',windows:'#e78308',fixtures:'#9d47c2'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let SHOWN={};
for(let id of Object.keys(DATA))$('drawing').add(new Option(id,id));
function choose(){let d=DATA[$('drawing').value];for(let side of ['left','right']){let previous=$(side).value;$(side).replaceChildren();for(let [key,p] of Object.entries(d.profiles))$(side).add(new Option(p.name,key));$(side).value=d.profiles[previous]?previous:side==='left'?'previous':'separated';}render();}
function render(){const d=DATA[$('drawing').value];SHOWN={};for(const side of ['left','right']){const p=d.profiles[$(side).value];let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" role="img" aria-label="${esc(p.name)}"><rect width="100%" height="100%" fill="white"/>`;
if($('source').checked)svg+=`<image href="${d.image}" width="${d.width}" height="${d.height}"/>`;
let shown=0;for(let i=0;i<p.features.length;i++){const f=p.features[i];if(!$(f.kind).checked||f.review&&!$('review').checked)continue;const key=side+'-'+i;SHOWN[key]=f;shown++;const color=f.review?'#c87008':colors[f.kind],fill=f.kind==='walls'?color:'none';svg+=`<path data-feature="${key}" d="${f.d}" fill="${fill}" fill-opacity=".24" fill-rule="evenodd" stroke="${color}" stroke-width="${f.kind==='walls'?'.7':'1.6'}" ${f.review?'stroke-dasharray="6 4"':''} style="cursor:pointer"><title>${esc(f.id||f.kind)} · ${esc(f.status)}${f.label?' · unverified model: '+esc(f.label):''}</title></path>`;
if(f.kind==='rooms'){let label=$('ids').checked&&f.id?f.id:'';if($('guesses').checked&&f.label)label+=(label?' · ':'')+'model: '+f.label;if(label)svg+=`<text x="${f.center[0]}" y="${f.center[1]}" fill="${color}" font-size="10" pointer-events="none">${esc(label)}</text>`;}}
svg+='</svg>';$(`${side}View`).innerHTML=svg;$(`${side}View`).firstChild.style.width=$('zoom').value+'%';const rooms=p.features.filter(f=>f.kind==='rooms'),review=rooms.filter(f=>f.review).length;$(`${side}Legend`).textContent=`${shown} displayed features · ${rooms.length-review} unverified/check-passing regions + ${review} flagged for review`;}
$('zoomLabel').textContent=$('zoom').value+'%';$('credit').innerHTML=`<a href="${d.license}">Source credit and licence</a> · <a href="refinement-assets/${$('drawing').value}-detail.json">Full detail JSON, including review cases</a>`;}
for(const side of ['left','right'])$(`${side}View`).onclick=event=>{const target=event.target.closest('[data-feature]');if(!target)return;const f=SHOWN[target.dataset.feature];$('inspector').textContent=JSON.stringify({id:f.id,kind:f.kind,status:f.status,review_reasons:f.review_reasons,model_name_guess:f.label,semantics_verified:false,stability_iou:f.stability_iou,mean_class_softmax_uncalibrated:f.class_mean_softmax},null,2);};
$('drawing').onchange=choose;for(let id of ['left','right','rooms','walls','doors','windows','fixtures','review','ids','guesses','source'])$(id).onchange=render;$('zoom').oninput=render;choose();
</script></html>"""
    page = page.replace("__ROWS__", "".join(rows)).replace(
        "__DATA__", json.dumps(drawings).replace("<", "\\u003c")
    )
    old = out / "refinement.html"
    if old.exists() and not (out / "refinement-v1.html").exists():
        shutil.copyfile(old, out / "refinement-v1.html")
    old.write_text(page)
    for name in ["instance-comparison.json", "instance-comparison.csv"]:
        shutil.copyfile(ROOT / name, out / name)
    (out / "instance-reproduction.txt").write_text(
        """Run from /root/work/junction2026 after the original experiment setup.
No training. Same checkpoint and 2048 RGB letterboxing. CAD is evaluation-only.

Recompute six selected drawings (previous campaigns are moved into local history):
docker run --rm --user 0 --gpus all -v "$PWD:/repo" -w /repo junction-cubicasa:gpu-comparison python packages/processing/experiments/compare_instances.py --predict

Recompute evaluation from saved outputs:
docker run --rm --user 0 -v "$PWD:/repo" -w /repo junction-cubicasa:gpu-comparison python packages/processing/experiments/compare_instances.py

Export this private viewer (substitute your output directory):
docker run --rm --user 0 -v "$PWD:/repo" -v /absolute/output/directory:/deliverables -w /repo junction-cubicasa:gpu-comparison python packages/processing/experiments/export_instances_preview.py --output /deliverables

API: /v1/predictions?model=cubicasa-detail&response_format=json|zip
Requires the existing private backend key. Default model is unchanged.
Code: packages/processing/cubicasa/detail.py and utils/room_instances.py.
Vendored polygonizer provenance and licence are in utils/official_postprocessing.py,
NOTICE.md and sources.lock.json. Raw arrays, structure pieces and review proposals
are retained. Review checks are heuristic, not calibrated correctness estimates.
Raw artifacts: .local/cubicasa-refinement-v2/adapter/<drawing>/.
"""
    )
    print(old)


if __name__ == "__main__":
    main()
