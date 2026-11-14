"""V4: image-supported wall masks and bounded footprint repairs; CAD evaluation only."""
import argparse
import json
import hashlib
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely import affinity, wkt
from shapely.ops import unary_union

from compare_instances import DRAWINGS, instance_metrics
from compare_alignment import preview
from export_instances_preview import feature
from wall_alignment import align_regions, wall_width

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cubicasa'))
from utils.room_instances import extract_instances, rasterize, mask_polygons, polygon_parts

BASE = Path('.local/cubicasa-refinement-v2/adapter')
DATA = Path('.local/gpu-comparison')
ROOT = Path('.local/cubicasa-refinement-v4')


def main(out):
    if ROOT.exists():
        history = ROOT.parent / 'cubicasa-refinement-v4-history'
        history.mkdir(exist_ok=True)
        ROOT.rename(history / str(time.time_ns()))
    ROOT.mkdir()
    assets = out / 'structure-assets'
    assets.mkdir(exist_ok=True)
    samples = {s['id']: s for s in json.loads((DATA / 'manifest.json').read_text())['samples']}
    results, profiles = [], {}
    for identifier in DRAWINGS:
        start = time.perf_counter()
        sample = samples[identifier]
        parent = BASE / identifier
        summary = json.loads((parent / 'predictions.json').read_text())
        raw = json.loads((parent / 'raw.json').read_text())
        tr = SimpleNamespace(**raw['transform'])
        sx, sy = tr.original_width / tr.content_width, tr.original_height / tr.content_height
        to_model = lambda g: affinity.scale(g, 1/sx, 1/sy, origin=(0,0))
        to_source = lambda g: affinity.scale(g, sx, sy, origin=(0,0))
        grids = np.load(parent / 'probabilities.npz')
        rooms, icons = grids['room'].astype(np.float32), grids['icon'].astype(np.float32)
        wall = rooms[2] + rooms[8]
        image = Image.open(sample['raster_path']).convert('L').resize((tr.content_width, tr.content_height), Image.Resampling.BILINEAR)
        ink = np.asarray(image) < 170
        near_ink = ndimage.maximum_filter(ink, size=5)
        walls = [to_model(wkt.loads(r['geometry_wkt'])) for r in summary['wall_polygons']]
        thickness = wall_width(walls)
        # Fixed before evaluation; model evidence distinguishes structure from generic ink.
        mask = (wall >= .65) | ((wall >= .35) & near_ink)
        labels, count = ndimage.label(mask)
        sizes = np.bincount(labels.ravel())
        mask &= sizes[labels] >= max(12, thickness*4)
        span = max(3, min(21, int(round(thickness*2)) | 1))
        connected = ndimage.binary_closing(mask, structure=np.ones((1,span))) | ndimage.binary_closing(mask, structure=np.ones((span,1)))
        bridge_support = (wall >= .2) & near_ink | (icons[2] >= .3)
        repaired_wall = mask | (connected & bridge_support)
        modified = rooms.copy()
        modified[2] = repaired_wall.astype(np.float32)
        modified[8] = 0
        structures, rejected = [], []
        for record in raw['official_structures']:
            shape = wkt.loads(record['geometry_wkt'])
            if not shape.is_valid or shape.is_empty:
                continue
            footprint = rasterize([shape], tr.content_width, tr.content_height, sx, sy)
            support = float(wall[footprint].mean()) if footprint.any() else 0
            ink_fraction = float(near_ink[footprint].mean()) if footprint.any() else 0
            if record['type'] == 'wall' and (support < .5 or ink_fraction < .1):
                rejected.append({**record, 'wall_head_mean':support, 'near_ink_fraction':ink_fraction})
                continue
            structures.append({'shape':shape, 'type':record['type'], 'class_id':record['class_id']})
        footprints = [wkt.loads(r['geometry_wkt']) for r in raw['official_room_regions']]
        union = unary_union(footprints)
        footprint_mask = rasterize(polygon_parts(union),tr.content_width,tr.content_height,sx,sy)
        radius = max(2,min(10,int(round(thickness))))
        closed = ndimage.binary_closing(footprint_mask, structure=np.ones((radius*2+1,radius*2+1)))
        additions = closed & ~footprint_mask & (wall < .25) & ~repaired_wall
        # Preserve the envelope: bounded repair only, with a fixed per-page expansion cap.
        if additions.sum() > footprint_mask.sum()*.03:
            additions[:] = False
        source_lines = np.load(Path('.local/cubicasa-refinement-v3')/identifier/'source-lines-model-pixels.npy')
        row = {'id':identifier,'parent_sha256':hashlib.sha256((parent/'predictions.json').read_bytes()).hexdigest(), 'wall_width_model_px':thickness,'bridge_span_model_px':span,'notch_radius_model_px':radius,'removed_wall_pixels':int((wall>=.5).sum()-((wall>=.5)&repaired_wall).sum()),'added_bridge_pixels':int((repaired_wall&~mask).sum()),'notch_added_pixels':int(additions.sum()),'rejected_vector_walls':len(rejected),'variants':{}}
        before = [wkt.loads(r['geometry_wkt']) for r in summary['room_instances']]
        truth = None
        ref = DATA/'cad-ground-truth'/(identifier+'.json')
        if ref.exists():
            reference = json.loads(ref.read_text())
            if reference['compatible']:
                minimum = tr.original_width*tr.original_height*.0001
                truth = [wkt.loads(g) for g in reference['reference_polygons_wkt'] if wkt.loads(g).area >= minimum]
                row['v2_cad'] = instance_metrics(before,truth)
        profiles[identifier] = {}
        directory = ROOT/identifier
        directory.mkdir()
        np.savez_compressed(directory/'evidence.npz',wall_mask=repaired_wall,footprint_additions=additions,source_ink=ink)
        for variant, repair in [('wall-evidence',False),('wall-and-notches',True),('source-faces',True)]:
            phase = time.perf_counter()
            footprint = mask_polygons(footprint_mask | additions if repair else footprint_mask,sx,sy,1)
            active_rooms = modified
            active_structures = structures
            if variant == 'source-faces':
                face_mask = ndimage.binary_closing(ink & (ndimage.maximum_filter(wall, size=3) >= .35), structure=np.ones((3,3))) | (wall >= .8)
                face_mask |= connected & bridge_support
                active_rooms = rooms.copy()
                active_rooms[2] = face_mask.astype(np.float32)
                active_rooms[8] = 0
                active_structures = [r for r in structures if r['type'] != 'wall']
                np.save(directory/'source-face-wall-mask.npy',face_mask)
            extracted = extract_instances(active_rooms, icons, footprint, active_structures, tr)
            model_shapes = [to_model(r['shape']) for r in extracted['instances']]
            accepted = extracted['structures']
            constraints = [to_model(r['shape']) for r in accepted if r['type']=='wall' or (r['type']=='icon' and r['class_id'] in {1,2})]
            actual_walls = [to_model(r['shape']) for r in accepted if r['type']=='wall']
            cleaned, cleanup = align_regions(model_shapes, actual_walls, constraints, source_lines)
            output_shapes = [to_source(g) for g in cleaned]
            records = []
            for i,(shape,original,detail) in enumerate(zip(output_shapes,extracted['instances'],cleanup['regions'])):
                parents = [r['instance_id'] for r,g in zip(summary['room_instances'],before) if shape.intersection(g).area > .05*min(shape.area,g.area)]
                reasons = list(dict.fromkeys(original['review_reasons'] + detail['boundary_review_reasons'] + ['experimental_wall_reconstruction']))
                records.append({'geometry_wkt':shape.wkt,'instance_id':f'V4-{i+1:03}','parent_v2_ids':parents,'confidence':None,'model_label':None,'semantics_verified':False,'status':'needs_review','review_reasons':reasons,'cleanup':detail})
            constraint_union=unary_union([to_source(g) for g in constraints])
            metrics={'regions':len(records),'vertices':sum(r['after']['vertices'] for r in cleanup['regions']),'valid':sum(g.is_valid for g in output_shapes),'max_region_overlap_px2':max((a.intersection(b).area for i,a in enumerate(output_shapes) for b in output_shapes[:i]),default=0),'max_accepted_barrier_overlap_px2':max((g.intersection(constraint_union).area for g in output_shapes),default=0),'seconds':time.perf_counter()-phase,'candidate_splits':sum(sum(parent in r['parent_v2_ids'] for r in records)>1 for parent in [p['instance_id'] for p in summary['room_instances']]),'candidate_merges':sum(len(r['parent_v2_ids'])>1 for r in records)}
            original_walls = unary_union([wkt.loads(r['geometry_wkt']) for r in summary['wall_polygons']])
            metrics['overlap_with_v2_wall_area_px2'] = unary_union(output_shapes).intersection(original_walls).area
            if truth is not None:
                metrics['cad'] = instance_metrics(output_shapes,truth)
            saved={'geometry_revision':'v4:'+variant,'experimental':True,'room_names_in_scope':False,'room_instances':records,'measurements':metrics,'rejected_vector_walls':rejected,'settings':{'wall_strong':.65,'wall_with_ink':.35,'vector_wall_minimum':.5,'ink_threshold':170,'max_footprint_expansion':.03},'model':summary['model'],'warning':'Reconstruction mask is a heuristic, not a new model probability. All outputs require review.'}
            (directory/(variant+'.json')).write_text(json.dumps(saved,indent=2))
            (assets/(identifier+'-'+variant+'.json')).write_text(json.dumps(saved))
            preview(sample['raster_path'],output_shapes,assets/(identifier+'-'+variant+'.png'))
            profiles[identifier][variant]={'name':'V4 '+variant,'features':[feature(r,'rooms',None,r['instance_id'],True) for r in records]}
            row['variants'][variant]=metrics
        row['total_seconds']=time.perf_counter()-start
        results.append(row)
        print(identifier,json.dumps(row['variants']),flush=True)
    report={'scope':'Same six drawings; saved pretrained outputs only; CAD evaluation only; room naming excluded. All v4 shapes are review proposals. No service adapter changed.','drawings':results}
    (ROOT/'comparison.json').write_text(json.dumps(report,indent=2))
    (out/'structure-comparison.json').write_text(json.dumps(report,indent=2))
    (out/'structure-profiles.json').write_text(json.dumps(profiles))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    main(parser.parse_args().output)
