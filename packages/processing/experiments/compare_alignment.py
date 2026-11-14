"""Saved-prediction v3 experiment. No training, CAD-assisted reconstruction or API changes."""
import argparse
import copy
import csv
import hashlib
import json
from pathlib import Path
import platform
import time

import numpy as np
from PIL import Image, ImageDraw
import scipy
import shapely
from shapely import affinity, wkt
from shapely.ops import unary_union
from skimage import feature as image_feature, transform
import skimage

from compare_instances import DRAWINGS, instance_metrics
from export_instances_preview import feature
from wall_alignment import AlignmentSettings, align_regions, boundary_metrics, wall_width

ROOT = Path('.local/cubicasa-refinement-v3')
BASE = Path('.local/cubicasa-refinement-v2/adapter')
DATA = Path('.local/gpu-comparison')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def aggregate(shapes, thickness):
    metrics = [boundary_metrics(shape, thickness) for shape in shapes]
    return {key: sum(m[key] for m in metrics) for key in ['vertices', 'short_segments', 'holes']}


def constraints(summary):
    records = summary['wall_polygons'] + [r for r in summary['icon_detections'] if r['class'] in {'Door', 'Window'}]
    return [wkt.loads(r['geometry_wkt']) for r in records]


def preview(source, shapes, destination, size=1800):
    image = Image.open(source).convert('RGB')
    sx = min(1, size / max(image.size))
    image = image.resize((round(image.width*sx), round(image.height*sx)))
    draw = ImageDraw.Draw(image)
    for shape in shapes:
        for ring in [shape.exterior, *shape.interiors]:
            draw.line([(x*sx, y*sx) for x, y in ring.coords], fill='#0086b8', width=2)
    image.save(destination)


def run(out):
    if ROOT.exists():
        history = ROOT.parent / 'cubicasa-refinement-v3-history'
        history.mkdir(exist_ok=True)
        ROOT.rename(history / str(time.time_ns()))
    ROOT.mkdir(parents=True)
    assets = out / 'alignment-assets'
    assets.mkdir(exist_ok=True)
    samples = {s['id']: s for s in json.loads((DATA/'manifest.json').read_text())['samples']}
    result = {'scope': 'Six fixed saved v2 drawings; exploratory paired experiment. CAD evaluation only; no training or inference rerun.', 'selected_variant': 'wall-aligned', 'selection_policy': 'Predeclared maximum 3 model-pixel tolerance, capped at 35% estimated wall width; not selected using CAD scores.', 'versions': {'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__, 'shapely': shapely.__version__, 'skimage': skimage.__version__}, 'drawings': []}
    profiles = {}
    for identifier in DRAWINGS:
        start = time.perf_counter()
        sample = samples[identifier]
        path = BASE/identifier/'predictions.json'
        summary = json.loads(path.read_text())
        raw_path = BASE/identifier/'raw.json'
        tr = json.loads(raw_path.read_text())['transform']
        sx, sy = tr['original_width']/tr['content_width'], tr['original_height']/tr['content_height']
        to_model = lambda g: affinity.scale(g, 1/sx, 1/sy, origin=(0,0))
        to_source = lambda g: affinity.scale(g, sx, sy, origin=(0,0))
        shapes = [to_model(wkt.loads(r['geometry_wkt'])) for r in summary['room_instances']]
        walls = [to_model(wkt.loads(r['geometry_wkt'])) for r in summary['wall_polygons']]
        barriers = [to_model(g) for g in constraints(summary)]
        image = Image.open(sample['raster_path']).convert('L').resize((tr['content_width'], tr['content_height']), Image.Resampling.BILINEAR)
        edges = image_feature.canny(np.asarray(image, dtype=np.float32)/255, sigma=1.2)
        lines = np.asarray(transform.probabilistic_hough_line(edges, threshold=12, line_length=30, line_gap=4, rng=42), dtype=float).reshape(-1,2,2)
        extraction_seconds = time.perf_counter()-start
        directory = ROOT/identifier
        directory.mkdir()
        np.save(directory/'source-lines-model-pixels.npy', lines)
        thickness = wall_width(walls)
        before_sources = [to_source(g) for g in shapes]
        row = {'id': identifier, 'input_sha256': digest(path), 'source_sha256': digest(Path(sample['raster_path'])), 'raw_sha256': digest(raw_path), 'image_and_source_line_preparation_seconds': extraction_seconds, 'source_line_count': len(lines), 'before': aggregate(shapes, thickness), 'variants': {}}
        truth = None
        reference_path = DATA/'cad-ground-truth'/(identifier+'.json')
        if reference_path.exists():
            reference = json.loads(reference_path.read_text())
            if reference['compatible']:
                minimum = sample['width']*sample['height']*summary['settings']['minimum_area_fraction']
                truth = [wkt.loads(g) for g in reference['reference_polygons_wkt'] if wkt.loads(g).area >= minimum]
                row['before_cad_all'] = instance_metrics(before_sources, truth)
                row['before_cad_same_cohort'] = instance_metrics([g for g,r in zip(before_sources,summary['room_instances']) if r['status']=='passes_structural_checks'], truth)
        for variant, fit in [('simplify-only',False), ('wall-aligned',True)]:
            started = time.perf_counter()
            cleaned, report = align_regions(shapes,walls,barriers,lines,fit_lines=fit)
            seconds = time.perf_counter()-started
            cleaned_source = [to_source(g) for g in cleaned]
            details = []
            for record, shape, evidence in zip(summary['room_instances'],cleaned_source,report['regions']):
                combined = list(dict.fromkeys(record['review_reasons'] + evidence['boundary_review_reasons']))
                details.append({**record, 'confidence': None, 'class_scores': None, 'parent_v2_class_evidence': {'model_label': record['model_label'], 'confidence': record['confidence'], 'class_scores': record['class_scores'], 'scope': 'Original v2 region, not the edited polygon'}, 'geometry_wkt': shape.wkt, 'area_px': shape.area, 'bbox': list(shape.bounds), 'review_reasons': combined, 'status': 'needs_review' if combined else 'passes_structural_checks', 'parent_v2_status': record['status'], 'cleanup': evidence, 'class_scores_apply_to': 'Original v2 region; not recomputed for the edited visualization geometry.'})
            if variant in {'wall-aligned', 'simplify-only'}:
                features = [feature(r,'rooms',r['model_label'],r['instance_id'],r['status']=='needs_review') for r in details]
                for f,r in zip(features,details):
                    f['cleanup'] = r['cleanup']
                profiles.setdefault(identifier, {})[variant] = {'name': 'Wall-aligned outlines · v3 experiment' if fit else 'Simplification-only control', 'features': features}
            overlap = max((a.intersection(b).area for i,a in enumerate(cleaned) for b in cleaned[:i]),default=0)
            barrier_overlap = max((g.intersection(unary_union(barriers)).area for g in cleaned),default=0)
            original_overlap = max((a.intersection(b).area for i,a in enumerate(shapes) for b in shapes[:i]),default=0)
            delta = {'after': aggregate(cleaned, thickness), 'accepted_edits':sum(r['accepted_edit'] for r in report['regions']), 'rejected_edits':sum(bool(r['rejection_reasons']) for r in report['regions']), 'region_count':len(cleaned), 'review_regions':sum(r['status']=='needs_review' for r in details), 'boundary_review_regions':sum(bool(r['boundary_review_reasons']) for r in report['regions']), 'max_boundary_hausdorff_model_px':max(r['boundary_hausdorff_model_px'] for r in report['regions']), 'max_abs_area_change_fraction':max(abs(r['area_change_fraction']) for r in report['regions']), 'max_pair_overlap_model_px2':overlap, 'parent_max_pair_overlap_model_px2':original_overlap, 'newly_separated_shared_boundaries':sum(shapes[i].boundary.intersection(shapes[j].boundary).length > report['tolerance_model_px']*2 and cleaned[i].boundary.distance(cleaned[j].boundary) > 0.1 for i in range(len(shapes)) for j in range(i)), 'max_barrier_overlap_model_px2':barrier_overlap, 'valid_polygons':sum(g.is_valid for g in cleaned), 'postprocessing_seconds':seconds, 'gpu_memory':None}
            if truth is not None:
                delta['cad_all'] = instance_metrics(cleaned_source,truth)
                delta['cad_same_cohort'] = instance_metrics([g for g,r in zip(cleaned_source,summary['room_instances']) if r['status']=='passes_structural_checks'],truth)
                delta['cad_display_without_review'] = instance_metrics([g for g,r in zip(cleaned_source,details) if r['status']=='passes_structural_checks'],truth)
            saved = {'model':summary['model'], 'geometry_revision':'v3:'+variant, 'experimental':True, 'service_default_changed':False, 'image':summary['image'], 'room_instances':details, 'report':report, 'measurements':delta, 'input_sha256':row['input_sha256'], 'score_meaning':'Original v2 model scores retained as provenance only; not calibrated or recomputed for new geometry.'}
            (directory/(variant+'.json')).write_text(json.dumps(saved,indent=2))
            preview(sample['raster_path'],cleaned_source,assets/(identifier+'-'+variant+'.png'))
            exported_name = identifier + ('-v3.json' if variant == 'wall-aligned' else '-simplify-only.json')
            (assets/exported_name).write_text(json.dumps(saved))
            row['variants'][variant] = delta
        preview(sample['raster_path'],before_sources,assets/(identifier+'-v2.png'))
        result['drawings'].append(row)
        print(identifier, row['before'], {k:v['after'] for k,v in row['variants'].items()}, flush=True)
    (ROOT/'comparison.json').write_text(json.dumps(result,indent=2))
    (out/'alignment-comparison.json').write_text(json.dumps(result,indent=2))
    (out/'alignment-profiles.json').write_text(json.dumps(profiles))
    rows=[]
    for d in result['drawings']:
        for variant,m in d['variants'].items():
            rows.append({'id':d['id'],'variant':variant,'before_vertices':d['before']['vertices'],'after_vertices':m['after']['vertices'],'before_short_segments':d['before']['short_segments'],'after_short_segments':m['after']['short_segments'],'accepted_edits':m['accepted_edits'],'rejected_edits':m['rejected_edits'],'review_regions':m['review_regions'],'max_boundary_shift_model_px':m['max_boundary_hausdorff_model_px'],'cad_union_iou_before':d.get('before_cad_all',{}).get('union_iou'),'cad_union_iou_after':m.get('cad_all',{}).get('union_iou'),'postprocessing_seconds':m['postprocessing_seconds']})
    with (out/'alignment-comparison.csv').open('w') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    (out/'alignment-reproduction.txt').write_text('From /root/work/junction2026, no GPU required; no training/inference rerun.\nPinned image: sha256:254ae156a8a0ab9b0435058e69a9ae0c0330d5c67a4865bad86625ad3dfef928\n\ndocker run --rm --user 0 --entrypoint python -v "$PWD:/repo" -v /absolute/output/directory:/deliverables -w /repo sha256:254ae156a8a0ab9b0435058e69a9ae0c0330d5c67a4865bad86625ad3dfef928 packages/processing/experiments/compare_alignment.py --output /deliverables\npython3 packages/processing/experiments/export_dashboard.py --output /absolute/output/directory\n\nCAD is evaluation only. Defaults were chosen before CAD evaluation. Both variants and rejection reasons are retained.\n')


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    run(parser.parse_args().output)
