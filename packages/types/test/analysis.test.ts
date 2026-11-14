import { expect, test } from 'bun:test';
import { AnalysisZod, AnswerZod, BoundingBoxZod, StoredAnalysisZod } from '../src/drawing';

const legacy = {
    summary: 'A room with a printed area.',
    observations: [
        {
            id: 'old-observation',
            page: 1,
            location: 'Lower-left room',
            fact: 'The room has a printed area of 12 m².',
            evidence: '12 m² label',
        },
    ],
    limitations: ['No linear calibration was established.'],
};

test('legacy analyses remain readable without invented classifications, scale or boxes', () => {
    const saved = StoredAnalysisZod.parse(legacy);
    expect(saved.classification).toBeNull();
    expect(saved.views).toEqual([]);
    expect(saved.missingInformation).toEqual([]);
    expect(saved.observations[0]).toMatchObject({
        view: null,
        kind: 'other',
        label: null,
        assumptions: [],
        boundingBox: null,
        recognition: 'uncertain',
        visibility: 'unknown',
        constructionState: 'unknown',
    });
    expect(saved.observations[0]).not.toHaveProperty('id');
    expect(AnalysisZod.parse(saved)).toEqual(saved);
    expect(AnswerZod.parse({ text: '12 m²', sources: ['old-observation'] })).toEqual({ text: '12 m²' });
});

test('observation assumptions survive persistence normalization without becoming facts', () => {
    const assumptions = ['This may be a bedroom.'];
    const saved = StoredAnalysisZod.parse({
        ...legacy,
        observations: [{ ...legacy.observations[0], assumptions }],
    });
    expect(saved.observations[0]?.assumptions).toEqual(assumptions);
    expect(saved.observations[0]?.fact).toBe(legacy.observations[0]?.fact);
    expect(saved).not.toHaveProperty('assumptions');
});

test('new analyses must explicitly provide metadata rather than receiving storage defaults', () => {
    expect(AnalysisZod.safeParse(legacy).success).toBe(false);
});

test('localization coordinates must stay in the normalized full-page space', () => {
    expect(BoundingBoxZod.safeParse({ left: -0.1, top: 0, right: 0.8, bottom: 0.8 }).success).toBe(false);
    expect(BoundingBoxZod.safeParse({ left: 0, top: 0, right: 1.1, bottom: 0.8 }).success).toBe(false);
    expect(BoundingBoxZod.parse({ left: 0, top: 0, right: 1, bottom: 1 })).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
});
