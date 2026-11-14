import { ScanCommentZod, type PpmCandidates } from '@repo/types';

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
            text: [
                candidate.description,
                `Evidence: ${candidate.evidence}`,
                candidate.estimatedPpm === null ? 'PPM could not be estimated.' : `Unverified estimate: ${candidate.estimatedPpm} pixels per metre.`,
                candidate.calculation,
                candidate.boundingBox === null ? 'The finding has no precise location; this comment covers the whole sheet.' : null,
            ]
                .filter((text) => text !== null)
                .join('\n\n')
                .slice(0, 6000),
        }),
    );
}
