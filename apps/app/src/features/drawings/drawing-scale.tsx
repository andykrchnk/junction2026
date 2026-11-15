import type { Blueprint, PpmCandidate } from '@repo/types';
import { useUnit } from 'effector-react';
import { Button } from '@repo/design-system/components/ui/button';
import { Trace, TraceLine, TraceTitle, TraceDescription } from '@repo/design-system/components/ui/trace';
import { ProgressStep } from './progress-step';
import { $$drawings } from './model';

const sourceNames = {
    written_dimension: 'Written dimension',
    scale_bar: 'Scale bar',
    printed_scale_ratio: 'Printed scale',
    known_area: 'Printed area',
    known_product: 'Product dimension',
    calibrated_drawing: 'Calibrated drawing',
} as const;
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);

function ScaleAnchor({ candidate, drawingId, hidden }: Readonly<{ candidate: PpmCandidate; drawingId: string; hidden: boolean }>) {
    const showRegion = useUnit($$drawings.canvasRegionRequested);
    return (
        <div className="space-y-2 border-b pb-3 last:border-0">
            <p className="font-medium text-foreground">
                {sourceNames[candidate.type]} · Sheet {candidate.page}
            </p>
            <p>{candidate.description}</p>
            <blockquote className="border-l pl-3">{candidate.evidence}</blockquote>
            {candidate.estimatedPpm !== null && <p>Reference estimate: {number(candidate.estimatedPpm)} px/m</p>}
            {candidate.calculation && <p>{candidate.calculation}</p>}
            {candidate.boundingBox && (
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={hidden}
                    onClick={() => showRegion({ id: drawingId, page: candidate.page, bounds: candidate.boundingBox, label: candidate.description })}
                >
                    Show anchor on drawing
                </Button>
            )}
        </div>
    );
}

export function DrawingScale({ blueprint, drawingId, busy }: Readonly<{ blueprint: Blueprint; drawingId: string; busy: boolean }>) {
    const reviewScale = useUnit($$drawings.reviewContextFx);
    const result = blueprint.ppm;
    const candidates = blueprint.ppmCandidates;
    const calibration = result?.calibration;
    const used = new Set(calibration?.usedCandidateIndexes ?? []);
    const state = blueprint.status;
    const running = state.type === 'processing' && state.stage === 'ppm';
    const failed = (state.type === 'partial' || state.type === 'failed') && state.stage === 'ppm';
    const remaining = (candidates ?? []).map((candidate, index) => ({ candidate, index })).filter(({ index }) => !used.has(index));
    return (
        <ProgressStep
            title="Drawing scale"
            status={running ? 'running' : failed ? 'error' : result ? undefined : 'pending'}
            detail={running ? 'Checking…' : failed ? 'Retry needed' : result?.value ? `${number(result.value)} px/m` : result ? 'Not established' : 'Waiting'}
        >
            <Trace>
                <TraceLine status={candidates !== null ? undefined : running ? 'running' : 'pending'}>
                    <TraceTitle>Find scale references</TraceTitle>
                    <TraceDescription className="text-xs">
                        {candidates === null ? (running ? 'Searching…' : 'Waiting') : `${candidates.length} found`}
                    </TraceDescription>
                </TraceLine>
                <TraceLine status={running && candidates !== null ? 'running' : result ? undefined : 'pending'}>
                    <TraceTitle>Evaluate and calculate</TraceTitle>
                </TraceLine>
            </Trace>
            {result && (
                <div className="space-y-2 border-y py-3">
                    <p className="font-medium text-foreground">
                        {result.value ? `${number(result.value)} px/m · ${running ? 'Previous estimate' : 'Estimated scale'}` : 'Scale not established'}
                    </p>
                    {calibration ? (
                        <>
                            <p>{calibration.scope}</p>
                            <p>{calibration.basis}</p>
                        </>
                    ) : result.value ? (
                        <p>Review scale to add linked evidence and calculation inputs.</p>
                    ) : (
                        <p>{result.message}</p>
                    )}
                </div>
            )}
            {calibration && used.size > 0 && (
                <ProgressStep title="Anchors used" status={undefined} detail={String(used.size)}>
                    {calibration.usedCandidateIndexes.map((index) => {
                        const candidate = candidates?.[index];
                        return candidate ? (
                            <ScaleAnchor key={index} candidate={candidate} drawingId={drawingId} hidden={!!blueprint.attachment.hiddenFromCanvas} />
                        ) : (
                            <p key={index}>Source reference unavailable.</p>
                        );
                    })}
                </ProgressStep>
            )}
            {calibration && result?.value && (
                <ProgressStep title="Calculation" status={undefined} detail={calibration.method === 'length' ? 'Distance' : 'Area'}>
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
                        <dt>{calibration.method === 'length' ? 'Drawing distance' : 'Drawing area'}</dt>
                        <dd>
                            {number(calibration.method === 'length' ? calibration.pixelLength : calibration.pixelArea)}{' '}
                            {calibration.method === 'length' ? 'px' : 'px²'}
                        </dd>
                        <dt>{calibration.method === 'length' ? 'Real distance' : 'Real area'}</dt>
                        <dd>
                            {number(calibration.method === 'length' ? calibration.realLengthMetres : calibration.realAreaSquareMetres)}{' '}
                            {calibration.method === 'length' ? 'm' : 'm²'}
                        </dd>
                        <dt>Result</dt>
                        <dd>{number(result.value)} px/m</dd>
                    </dl>
                    <p className="break-words">
                        {calibration.method === 'length'
                            ? `${number(calibration.pixelLength)} px ÷ ${number(calibration.realLengthMetres)} m`
                            : `√(${number(calibration.pixelArea)} px² ÷ ${number(calibration.realAreaSquareMetres)} m²)`}{' '}
                        = {number(result.value)} px/m
                    </p>
                    <p>
                        Canonical raster: {blueprint.raster?.width} × {blueprint.raster?.height} px
                    </p>
                </ProgressStep>
            )}
            {remaining.length > 0 && (
                <ProgressStep title={calibration ? 'Other references checked' : 'Scale references'} status={undefined} detail={String(remaining.length)}>
                    {remaining.map(({ candidate, index }) => (
                        <ScaleAnchor key={index} candidate={candidate} drawingId={drawingId} hidden={!!blueprint.attachment.hiddenFromCanvas} />
                    ))}
                </ProgressStep>
            )}
            {result?.value && (
                <ProgressStep title="Resolution details" status={undefined} detail="Explanation">
                    <p>{result.message}</p>
                </ProgressStep>
            )}
            {!result && (
                <p>
                    {failed
                        ? 'Scale review paused. Resume analysis to retry.'
                        : running
                          ? candidates === null
                              ? 'Locating dimensions and scale references…'
                              : 'Checking evidence and calculating the drawing scale…'
                          : 'Waiting to check drawing scale.'}
                </p>
            )}
            <Button
                size="sm"
                variant="ghost"
                disabled={busy || state.type !== 'ready'}
                onClick={() => {
                    void reviewScale({ id: drawingId, blueprintId: blueprint.id, section: 'scale' }).catch(() => {});
                }}
            >
                Review scale
            </Button>
        </ProgressStep>
    );
}
