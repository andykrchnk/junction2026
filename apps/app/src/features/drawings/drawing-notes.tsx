import type { Blueprint } from '@repo/types';
import { useUnit } from 'effector-react';
import { Button } from '@repo/design-system/components/ui/button';
import { ProgressStep } from './progress-step';
import { $$drawings } from './model';

const topics = {
    sheet_details: 'Sheet details',
    general_notes: 'General notes',
    legend: 'Legend and symbols',
    abbreviations: 'Abbreviations',
    dimensions: 'Dimensions and units',
} as const;

export function DrawingNotes({ blueprint, drawingId, busy }: Readonly<{ blueprint: Blueprint; drawingId: string; busy: boolean }>) {
    const showRegion = useUnit($$drawings.canvasRegionRequested);
    const reviewNotes = useUnit($$drawings.reviewContextFx);
    const notes = blueprint.misc;
    const state = blueprint.status;
    const running = state.type === 'processing' && state.stage === 'misc';
    const failed = (state.type === 'partial' || state.type === 'failed') && state.stage === 'misc';
    return (
        <ProgressStep
            title="Drawing notes"
            status={running ? 'running' : notes !== null ? undefined : failed ? 'error' : 'pending'}
            detail={running ? 'Reading…' : notes !== null ? `${notes.length} notes` : failed ? 'Retry needed' : 'Waiting'}
        >
            {blueprint.layout?.summary && <p className="text-foreground">{blueprint.layout.summary}</p>}
            {notes === null ? (
                <p>
                    {running
                        ? 'Reading the sheet title, legend and general notes…'
                        : failed
                          ? 'Drawing notes could not be read. Resume analysis to retry.'
                          : 'Waiting to read drawing notes.'}
                </p>
            ) : notes.length === 0 ? (
                <p>No additional drawing notes found.</p>
            ) : (
                Object.entries(topics).map(([category, title]) => {
                    const entries = notes.filter((note) => (note.category ?? 'general_notes') === category);
                    if (!entries.length) return null;
                    return (
                        <ProgressStep key={category} title={title} status={undefined} detail={String(entries.length)}>
                            {entries.map((note, index) => (
                                <div key={index} className="space-y-2 border-b pb-3 last:border-0">
                                    <p className="font-medium text-foreground">{note.title}</p>
                                    <p>{note.content}</p>
                                    {note.originalText && (
                                        <details>
                                            <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">
                                                Original drawing text
                                            </summary>
                                            <blockquote className="mt-2 border-l pl-3">{note.originalText}</blockquote>
                                        </details>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={blueprint.attachment.hiddenFromCanvas}
                                        onClick={() =>
                                            showRegion({ id: drawingId, page: blueprint.pageNumber, bounds: note.boundingBox ?? null, label: note.title })
                                        }
                                    >
                                        {note.boundingBox ? 'Show note on drawing' : 'Show sheet'}
                                    </Button>
                                </div>
                            ))}
                        </ProgressStep>
                    );
                })
            )}
            <Button
                size="sm"
                variant="ghost"
                disabled={busy || state.type !== 'ready'}
                onClick={() => {
                    void reviewNotes({ id: drawingId, blueprintId: blueprint.id, section: 'notes' }).catch(() => {});
                }}
            >
                Review notes
            </Button>
        </ProgressStep>
    );
}
