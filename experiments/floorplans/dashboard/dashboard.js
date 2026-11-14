'use strict';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let DATA,
    current = '00-cubicasa5k',
    box,
    scale = 1,
    original = false,
    selected = null;
let decisions = {};
try {
    decisions = JSON.parse(localStorage.getItem('floorplan-review-v2') || '{}');
} catch {
    decisions = {};
}
if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) decisions = {};
const active = () => $('result').value;
const profile = () => DATA.drawings[current].profiles[active()];
const reviewCount = (d) => d.profiles[active()]?.features.filter((f) => f.kind === 'rooms' && f.review).length || 0;
const name = (id) => id.replace(/^\d+-/, '').replaceAll('_', ' ');
function tab(id) {
    document.querySelectorAll('.tab').forEach((el) => {
        el.hidden = el.id !== id;
    });
    document.querySelectorAll('[data-tab]').forEach((el) => {
        el.classList.toggle('active', el.dataset.tab === id);
        el.setAttribute('aria-pressed', String(el.dataset.tab === id));
    });
}
function list() {
    const ids = Object.keys(DATA.drawings).filter(
        (id) => $('scope').value === 'all' || ($('scope').value === 'review' ? reviewCount(DATA.drawings[id]) > 0 : DATA.drawings[id].evidence),
    );
    $('drawings').innerHTML = ids
        .map(
            (id) =>
                `<button class="drawing ${id === current ? 'active' : ''}" data-drawing="${id}" aria-pressed="${id === current}">${esc(name(id))} <small>· ${id.slice(0, 2)}</small><span>${DATA.drawings[id].evidence ? (reviewCount(DATA.drawings[id]) ? reviewCount(DATA.drawings[id]) + ' regions flagged' : 'Latest result available') : 'Original benchmark only'}</span></button>`,
        )
        .join('');
    if (!ids.includes(current)) choose(ids[0]);
}
function choose(id) {
    current = id;
    selected = null;
    original = false;
    $('original').textContent = 'Show original';
    const d = DATA.drawings[id];
    box = [0, 0, d.width, d.height];
    scale = 1;
    $('title').textContent = `${name(id)} · ${id.slice(0, 2)}`;
    $('subtitle').textContent =
        `${d.width.toLocaleString()} × ${d.height.toLocaleString()} px · ${d.evidence ? 'Latest geometry available' : 'Latest geometry not run'}`;
    $('credit').href = d.license;
    $('download').href = d.evidence
        ? active() === 'wall-aligned'
            ? `alignment-assets/${id}-v3.json`
            : active() === 'simplify-only'
              ? `alignment-assets/${id}-simplify-only.json`
              : `refinement-assets/${id}-detail.json`
        : `assets/${id}-cubicasa.png`;
    $('download').textContent = d.evidence ? 'Download result' : 'Open baseline';
    for (const option of $('version').options) option.disabled = option.value !== 'baseline' && !d.evidence;
    if (!d.evidence) $('version').value = 'baseline';
    list();
    stats();
    render();
    queue();
    $('selection').textContent = d.evidence
        ? 'Click a current outline to inspect it, or choose a flagged region above.'
        : 'This drawing has original benchmark results only. No current result has been inferred.';
}
function stats() {
    if (active() !== 'separated' && DATA.drawings[current].alignment) {
        alignmentStats();
        return;
    }
    const e = DATA.drawings[current].evidence,
        baseline = $('version').value === 'baseline';
    $('takeaway').classList.toggle('warn', !!e?.after_default?.merged_reference_regions);
    $('takeaway').textContent = !e
        ? 'Latest geometry has not been run on this drawing. Compare the available original model outputs in the detailed report.'
        : current === '21-swiss_dwellings'
          ? 'Review first: the complex plan still has merged regions, including proposals that pass the checks.'
          : e.needs_review
            ? 'Inspect the flagged regions before using these outlines. Hiding them also removes some legitimate coverage.'
            : 'No region was flagged by the current checks. This does not verify the geometry or room names.';
    const metric = (label, value, note = '') =>
        `<div class="metric"><span>${label}</span><strong>${value}</strong>${note ? `<small> ${note}</small>` : ''}</div>`;
    if (!e) {
        $('metrics').innerHTML = metric('CURRENT GEOMETRY', 'Not run');
        return;
    }
    const after = $('review').checked ? e.after_all : e.after_default;
    let html =
        metric(
            'CURRENT REGION PROPOSALS',
            $('review').checked ? e.all_candidates : e.passes_checks,
            $('review').checked ? 'includes flagged' : 'flags excluded',
        ) + metric('REGIONS FLAGGED', e.needs_review);
    if (e.before && !baseline && $('version').value === 'previous')
        html +=
            metric('MATCHED CAD REGIONS', `${e.before.matched_iou_05} → ${after.matched_iou_05}`, `/ ${after.reference_regions}`) +
            metric('MERGED PROPOSALS', `${e.before.merged_reference_regions} → ${after.merged_reference_regions}`);
    else html += metric('GEOMETRY ACCURACY', e.before ? 'Select v1 comparison' : 'Not scored', e.before ? '' : 'no compatible reference');
    $('metrics').innerHTML = html;
}
function svg(profile, side) {
    const d = DATA.drawings[current],
        width = d.width,
        height = d.height;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.join(' ')}" aria-label="${side === 'left' ? 'Previous' : 'Current'} outlines" role="img"><rect width="${width}" height="${height}" fill="white"/><image href="${d.image}" width="${width}" height="${height}"/>`;
    if (!original) {
        if (side === 'left' && $('version').value === 'baseline') s += `<image href="assets/${current}-cubicasa.png" width="${width}" height="${height}"/>`;
        else
            for (const [i, f] of (profile?.features || []).entries()) {
                const visible =
                    f.kind === 'rooms' ||
                    (f.kind === 'walls' && $('walls').checked) ||
                    (['doors', 'windows'].includes(f.kind) && $('openings').checked) ||
                    (f.kind === 'fixtures' && $('fixtures').checked);
                if (!visible || (f.review && !$('review').checked)) continue;
                const color = f.review ? '#bf7417' : { rooms: '#0784b7', walls: '#58675d', doors: '#28885c', windows: '#c48323', fixtures: '#9659a5' }[f.kind];
                s += `<path d="${f.d}" fill="${f.kind === 'walls' ? color : 'none'}" fill-opacity=".2" fill-rule="evenodd" stroke="${color}" stroke-width="${selected === i && side === 'right' ? 3.2 : 1.4}" ${f.review ? 'stroke-dasharray="6 4"' : ''} ${side === 'right' ? `data-index="${i}"` : ''}><title>${esc(f.id || f.kind)} · ${f.review ? 'flagged for review' : 'unverified proposal'}</title></path>`;
                if ($('names').checked && f.kind === 'rooms' && f.label)
                    s += `<text x="${f.center[0]}" y="${f.center[1]}" fill="${color}" font-size="${width / 100}" pointer-events="none">${esc(f.label)}</text>`;
            }
        if ($('reference').checked && d.profiles.cad)
            for (const f of d.profiles.cad.features)
                s += `<path d="${f.d}" fill="none" stroke="#bf36a0" stroke-width="1.2" stroke-dasharray="3 4" pointer-events="none"/>`;
    }
    return s + '</svg>';
}
function render() {
    const d = DATA.drawings[current];
    $('beforetitle').textContent =
        $('version').value === 'baseline'
            ? 'Original CubiCasa · 1024'
            : $('version').value === 'separated'
              ? 'Separated outlines · v2'
              : 'Clean outlines · v1 / 2048';
    $('left').innerHTML = svg(d.profiles[$('version').value], 'left');
    $('right').innerHTML = profile()
        ? svg(profile(), 'right')
        : '<div class="empty"><strong>Not run yet</strong><span>Current outlines are available on six drawings.</span><a href="report-detailed.html">View original model comparison →</a></div>';
    $('zoomlabel').textContent = scale === 1 ? 'Fit' : `${Math.round(scale * 100)}%`;
}
function queue() {
    const d = DATA.drawings[current],
        flags =
            profile()
                ?.features.map((f, i) => ({ ...f, index: i }))
                .filter((f) => f.kind === 'rooms' && f.review) || [];
    $('reviewcount').textContent = !d.evidence
        ? 'No current result to review.'
        : flags.length
          ? `${flags.length} flagged region proposals. Select one to zoom both views.`
          : 'No region flags. Click any outline for a spot check.';
    $('queue').innerHTML = flags.map((f) => `<button data-focus="${f.index}">${esc(f.id)} ↗</button>`).join('');
}
function inspect(i, focus = false) {
    const f = profile().features[i];
    selected = i;
    if (focus) {
        $('review').checked = true;
        render();
        const target = $('right').querySelector(`[data-index="${i}"]`);
        if (target) {
            const b = target.getBBox(),
                d = DATA.drawings[current],
                pad = Math.max(b.width, b.height) * 0.18;
            box = [b.x - pad, b.y - pad, Math.max(b.width + pad * 2, d.width * 0.08), Math.max(b.height + pad * 2, d.height * 0.08)];
            scale = d.width / box[2];
        }
    }
    render();
    stats();
    const key = `${active()}:${current}:${f.id || f.kind + '-' + i}`;
    $('selection').innerHTML =
        `<strong>${esc(f.id || f.label || f.kind)} · ${f.review ? 'Flagged for review' : 'Unverified proposal'}</strong><div>${f.review_reasons.length ? esc(f.review_reasons.join(' · ').replaceAll('_', ' ')) : 'No heuristic flag. Check the source drawing for missed walls or merged spaces.'}</div>${f.cleanup ? `<div class="small">Boundary vertices: ${f.cleanup.before.vertices} → ${f.cleanup.after.vertices}. ${f.cleanup.rejection_reasons.length ? 'V2 geometry retained: ' + esc(f.cleanup.rejection_reasons.join(', ').replaceAll('_', ' ')) : 'Cleanup accepted within the displacement and area limits.'}</div>` : ''}<div class="muted small">Model name guess: ${esc(f.label || 'not provided')} · not verified</div><div class="actions"><button data-decision="keep">Looks usable</button><button data-decision="fix">Needs correction</button><button id="export">Export review notes</button></div><div id="saved" class="small">${decisions[key] ? 'Your local note: ' + esc(decisions[key].decision) : 'Notes are saved only in this browser. They do not change model outputs.'}</div>`;
    document.querySelectorAll('[data-decision]').forEach(
        (b) =>
            (b.onclick = () => {
                decisions[key] = {
                    drawing: current,
                    feature: f.id || f.kind + '-' + i,
                    decision: b.dataset.decision,
                    model: 'cubicasa-detail',
                    revision: active(),
                    output_updated: false,
                };
                try {
                    localStorage.setItem('floorplan-review-v2', JSON.stringify(decisions));
                    $('saved').textContent = 'Saved in this browser: ' + b.dataset.decision + '. Model outputs unchanged.';
                } catch {
                    $('saved').textContent = 'Browser storage unavailable. Export your notes to keep them.';
                }
            }),
    );
    $('export').onclick = () => {
        const url = URL.createObjectURL(
            new Blob([JSON.stringify({ scope: 'Local manual notes; not accuracy labels', notes: Object.values(decisions) }, null, 2)], {
                type: 'application/json',
            }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = 'floorplan-review-notes.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
}
function zoom(factor, center) {
    const d = DATA.drawings[current],
        next = Math.max(1, Math.min(scale * factor, 15)),
        ratio = scale / next;
    const cx = center?.[0] ?? box[0] + box[2] / 2,
        cy = center?.[1] ?? box[1] + box[3] / 2;
    box = [cx - (cx - box[0]) * ratio, cy - (cy - box[1]) * ratio, box[2] * ratio, box[3] * ratio];
    scale = next;
    if (next === 1) box = [0, 0, d.width, d.height];
    render();
}
function point(e, node) {
    const svg = node.querySelector('svg');
    return svg ? new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()) : null;
}
for (const id of ['left', 'right']) {
    const viewport = $(id);
    let drag;
    viewport.addEventListener(
        'wheel',
        (e) => {
            if (!viewport.querySelector('svg')) return;
            e.preventDefault();
            const p = point(e, viewport);
            zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, [p.x, p.y]);
        },
        { passive: false },
    );
    viewport.onpointerdown = (e) => {
        if (!viewport.querySelector('svg')) return;
        const p = point(e, viewport);
        drag = { x: e.clientX, y: e.clientY, p, box: [...box], index: e.target.dataset.index };
        viewport.setPointerCapture(e.pointerId);
    };
    viewport.onpointermove = (e) => {
        if (!drag) return;
        const p = point(e, viewport);
        box[0] += drag.p.x - p.x;
        box[1] += drag.p.y - p.y;
        render();
    };
    viewport.onpointerup = (e) => {
        if (!drag) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5 && drag.index !== undefined) inspect(Number(drag.index));
        drag = null;
    };
    viewport.onpointercancel = () => {
        drag = null;
    };
}
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
$('drawings').onclick = (e) => {
    const b = e.target.closest('[data-drawing]');
    if (b) choose(b.dataset.drawing);
};
$('queue').onclick = (e) => {
    const b = e.target.closest('[data-focus]');
    if (b) inspect(Number(b.dataset.focus), true);
};
$('scope').onchange = list;
$('result').onchange = () => {
    selected = null;
    choose(current);
};
for (const id of ['review', 'version', 'walls', 'openings', 'fixtures', 'names', 'reference'])
    $(id).onchange = () => {
        render();
        stats();
    };
$('zoomin').onclick = () => zoom(1.5);
$('zoomout').onclick = () => zoom(1 / 1.5);
$('reset').onclick = () => {
    const d = DATA.drawings[current];
    box = [0, 0, d.width, d.height];
    scale = 1;
    render();
};
$('original').onclick = () => {
    original = !original;
    $('original').textContent = original ? 'Show outlines' : 'Show original';
    render();
};

function alignmentStats() {
    const d = DATA.drawings[current],
        row = d.alignment,
        m = row.variants[active()];
    const shown = profile().features.filter((f) => f.kind === 'rooms' && ($('review').checked || !f.review));
    const count = (key) => shown.reduce((sum, f) => sum + f.cleanup.after[key], 0);
    const paired = $('version').value === 'separated' && $('review').checked;
    const metric = (label, value, note = '') => `<div class="metric"><span>${label}</span><strong>${value}</strong><small> ${note}</small></div>`;
    $('takeaway').classList.add('warn');
    $('takeaway').textContent =
        'V3 simplifies the outlines. Larger notches and missed walls remain; flagged proposals need review. CAD footprint overlap decreases slightly on all three scored drawings.';
    let html =
        metric('BOUNDARY VERTICES', paired ? `${row.before.vertices} → ${count('vertices')}` : count('vertices')) +
        metric(
            'SHORT SEGMENTS',
            paired ? `${row.before.short_segments} → ${count('short_segments')}` : count('short_segments'),
            'shorter than estimated wall width',
        ) +
        metric('REGIONS FLAGGED', m.review_regions, `/ ${m.region_count}`);
    const cad = $('review').checked ? m.cad_all : m.cad_display_without_review;
    if (cad)
        html += metric(
            'VISIBLE CAD MATCHES',
            paired ? `${row.before_cad_all.matched_iou_05} → ${cad.matched_iou_05}` : cad.matched_iou_05,
            `/ ${cad.reference_regions}`,
        );
    else html += metric('GEOMETRY ACCURACY', 'Not scored', 'no compatible reference');
    $('metrics').innerHTML = html;
}
function alignmentProgress() {
    const rows = DATA.alignment?.drawings || [];
    const before = rows.reduce((n, d) => n + d.before.vertices, 0),
        after = rows.reduce((n, d) => n + d.variants['wall-aligned'].after.vertices, 0);
    $('alignment-summary').textContent = rows.length
        ? `${rows.length} drawings · ${Math.round((1 - after / before) * 100)}% fewer vertices. No added overlaps or lost holes. CAD match counts unchanged; footprint IoU slightly lower.`
        : 'No saved v3 experiment.';
    $('alignmentrows').innerHTML = rows
        .map((d) => {
            const m = d.variants['wall-aligned'];
            return `<tr><td>${esc(name(d.id))} · ${d.id.slice(0, 2)}</td><td>${d.before.vertices} → ${m.after.vertices}</td><td>${d.before.short_segments} → ${m.after.short_segments}</td><td>${m.cad_all ? `${d.before_cad_all.union_iou.toFixed(3)} → ${m.cad_all.union_iou.toFixed(3)}` : 'Not scored'}</td><td><button data-alignment="${d.id}">Compare outlines →</button></td></tr>`;
        })
        .join('');
    $('alignmentrows').onclick = (e) => {
        const b = e.target.closest('[data-alignment]');
        if (b) {
            $('result').value = 'wall-aligned';
            $('version').value = 'separated';
            $('scope').value = 'updated';
            $('review').checked = true;
            choose(b.dataset.alignment);
            tab('compare');
        }
    };
}

async function start() {
    try {
        const response = await fetch('dashboard-data.json');
        if (!response.ok) throw Error('Saved evidence unavailable');
        DATA = await response.json();
        if (!DATA.alignment) $('result').value = 'separated';
        if (!DATA.drawings?.[current] || !Array.isArray(DATA.benchmark?.models)) throw Error('Saved evidence has an unexpected format');
        $('load').hidden = true;
        $('app').hidden = false;
        choose(current);
        $('progressrows').innerHTML = Object.entries(DATA.drawings)
            .filter(([, d]) => d.evidence?.before)
            .map(([id, d]) => {
                const e = d.evidence;
                return `<tr><td>Swiss · ${id.slice(0, 2)}</td><td>${e.before.matched_iou_05} → ${e.after_default.matched_iou_05} / ${e.before.reference_regions}</td><td>${e.before.merged_reference_regions} → ${e.after_default.merged_reference_regions}</td><td><button data-open="${id}">${e.after_default.merged_reference_regions ? 'Review merges' : 'Spot-check improvement'} →</button></td></tr>`;
            })
            .join('');
        $('progressrows').onclick = (e) => {
            const b = e.target.closest('[data-open]');
            if (b) {
                $('scope').value = 'updated';
                choose(b.dataset.open);
                tab('compare');
            }
        };
        alignmentProgress();
        const roles = {
            cubicasa: 'Baseline geometry · default',
            raster2seq: 'Alternative geometry',
            'grounding-sam': 'Detection & segmentation',
            paddleocr: 'Text & dimensions',
        };
        $('modelrows').innerHTML =
            DATA.benchmark.models
                .map(
                    (m) =>
                        `<tr><td>${esc(m.model)}</td><td>${roles[m.model]}</td><td>${m.successful} / ${m.attempted} completed</td><td>${m.warmed_pipeline_median_seconds.toFixed(2)} s</td></tr>`,
                )
                .join('') +
            '<tr><td>CubiCasa geometry · v3</td><td>Saved boundary cleanup experiment</td><td>6 / 6 completed · service unchanged</td><td>CPU postprocessing</td></tr><tr><td>CubiCasa detail · v2</td><td>Experimental separated geometry</td><td>6 / 6 completed</td><td>Separate campaign</td></tr><tr><td>RoomFormer</td><td>Geometry reconstruction</td><td>Blocked: no compatible scan-density input</td><td>Not run</td></tr><tr><td>SymPointV2</td><td>Vector / CAD</td><td>Blocked: SVG parser incompatibilities</td><td>Not run</td></tr>';
    } catch (error) {
        $('load').textContent = 'Unable to load saved results. Refresh through the private report server. ' + error.message;
        $('app').hidden = true;
    }
}
start();
