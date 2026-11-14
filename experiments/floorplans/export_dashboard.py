"""Refresh the private dashboard from saved evidence; no inference or API calls."""
import argparse
import json
from pathlib import Path
import re
import shutil


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    out = parser.parse_args().output
    # Preserve the reports people already use; never replace an earlier archive.
    for source, archive in [('report.html', 'report-detailed.html'), ('refinement.html', 'refinement-v2.html')]:
        if not (out / archive).exists():
            shutil.copyfile(out / source, out / archive)
    preview = (out / 'refinement-v2.html').read_text()
    match = re.search(r'const DATA=(.*?);\s*const \$=', preview, re.S)
    if not match:
        raise ValueError('The saved refinement viewer does not contain its geometry payload')
    drawings = json.loads(match.group(1))
    comparison = json.loads((out / 'instance-comparison.json').read_text())
    manifest = json.loads((out / 'manifest.json').read_text())
    measurements = {row['id']: row for row in comparison['drawings']}
    for sample in manifest['samples']:
        identifier = sample['id']
        if identifier not in drawings:
            drawings[identifier] = { 'width': sample['width'], 'height': sample['height'], 'image': f'assets/{identifier}-original.png', 'license': f"licenses/{sample['source']}.md", 'profiles': {} }
        drawings[identifier]['evidence'] = measurements.get(identifier)
        drawings[identifier]['source'] = sample['source']
    alignment_path = out / 'alignment-comparison.json'
    alignment = json.loads(alignment_path.read_text()) if alignment_path.exists() else None
    if alignment is not None:
        profiles = json.loads((out / 'alignment-profiles.json').read_text())
        for row in alignment['drawings']:
            identifier = row['id']
            drawings[identifier]['alignment'] = row
            for variant, profile in profiles[identifier].items():
                # The structural overlay is unchanged; only room outlines are edited.
                structures = [f for f in drawings[identifier]['profiles']['separated']['features'] if f['kind'] != 'rooms']
                drawings[identifier]['profiles'][variant] = {**profile, 'features': profile['features'] + structures}
    data = {'alignment': alignment, 'drawings': drawings, 'benchmark': json.loads((out / 'comparison.json').read_text()), 'scope': comparison}
    (out / 'dashboard-data.json').write_text(json.dumps(data))
    template = Path(__file__).with_name('dashboard')
    for name in ['dashboard.js', 'dashboard.css', 'structure.html']:
        shutil.copyfile(template / name, out / name)
    for name in ['report.html', 'refinement.html']:
        shutil.copyfile(template / 'index.html', out / name)
    (out / 'dashboard-reproduction.txt').write_text('From /root/work/junction2026:\npython3 packages/processing/experiments/export_dashboard.py --output ' + str(out.resolve()) + '\nReuses saved predictions. No model runs, training, or paid API requests.\n')


if __name__ == '__main__':
    main()
