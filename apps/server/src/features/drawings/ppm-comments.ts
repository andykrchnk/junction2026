import { ScanCommentZod, type PpmCandidate, type PpmCandidates } from '@repo/types';

function annotationText(candidate: PpmCandidate): string {
    const measurement = candidate.measurement;
    const scale =
        candidate.estimatedPpm === null
            ? 'Scale unresolved.'
            : measurement
              ? `${Number(Math.hypot(measurement.end.x - measurement.start.x, measurement.end.y - measurement.start.y).toFixed(2))} px ÷ ${measurement.realLengthMetres} m ≈ ${candidate.estimatedPpm} px/m (unverified). ${
                    { explicit: 'Printed units.', convention: 'Units inferred from drawing convention.', user: 'User-provided dimension.' }[
                        measurement.unitBasis
                    ]
                }`
              : candidate.calculation
                ? `${candidate.calculation} (unverified).`
                : `Estimate: ${candidate.estimatedPpm} px/m (unverified).`;
    return [candidate.description.trim(), scale, candidate.boundingBox === null ? 'Location unknown; annotation covers the sheet.' : null]
        .filter((text) => text !== null)
        .join('\n\n');
}

export function createPpmComments(params: Readonly<{ candidates: PpmCandidates; createdAt: string }>) {
    return params.candidates.map((candidate, index) =>
        ScanCommentZod.parse({
            id: `ppm:${candidate.page}:${index}`,
            page: candidate.page,
            application: 'area',
            source: 'ppm',
            type: 'annotation',
            createdAt: params.createdAt,
            boundaries: candidate.boundingBox ?? { left: 0, top: 0, right: 1, bottom: 1 },
            text: annotationText(candidate),
        }),
    );
}
