import type { Analysis } from '@repo/types';

const readable = (value: string) => value.replaceAll('_', ' ');

export function AnalysisMetadata({ analysis }: Readonly<{ analysis: Analysis }>) {
    const classification = analysis.classification;
    return (
        <div className="mt-4 space-y-4 text-xs">
            {classification && (
                <div className="rounded-md border p-3">
                    <p className="font-medium">Image classification</p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                        <dt>Content</dt>
                        <dd>{classification.contentTypes.map(readable).join(', ') || 'Unknown'}</dd>
                        <dt>Drawing</dt>
                        <dd>
                            {readable(classification.drawingStyle)} · {readable(classification.captureMode)} · {readable(classification.layout)}
                        </dd>
                        <dt>Readability</dt>
                        <dd>
                            Text: {readable(classification.readability.text)} · Lines: {readable(classification.readability.linework)} · Symbols:{' '}
                            {readable(classification.readability.symbols)}
                        </dd>
                        <dt>Visible issues</dt>
                        <dd>{classification.issues.map(readable).join(', ') || 'None reported'}</dd>
                        <dt>Languages</dt>
                        <dd>{classification.languages.join(', ') || 'Not established'}</dd>
                        <dt>Units</dt>
                        <dd>{classification.units.join(', ') || 'Not established'}</dd>
                    </dl>
                </div>
            )}
            {analysis.views.length > 0 && (
                <details className="rounded-md border p-3">
                    <summary className="cursor-pointer font-medium">Views and measurement evidence · {analysis.views.length} views</summary>
                    <p className="text-muted-foreground mt-2">
                        Printed scales are inscriptions, not confirmed pixel calibration. Each reference applies only to its own view.
                    </p>
                    {analysis.views.map((view, index) => (
                        <div key={index} className="mt-3 border-t pt-3">
                            <p className="font-medium">
                                Page {view.page} · {view.title ?? view.location}
                            </p>
                            <p className="text-muted-foreground mt-1">
                                {view.location} · {view.contentTypes.map(readable).join(', ')}
                            </p>
                            {view.measurementReferences.length > 0 ? (
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    {view.measurementReferences.map((reference, index) => (
                                        <li key={index}>
                                            {readable(reference.kind)}: “{reference.text}”{reference.units ? ` (${reference.units})` : ''} ·{' '}
                                            {reference.location}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="mt-2">No measurement reference established.</p>
                            )}
                            {view.measurementLimitations.length > 0 && (
                                <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
                                    {view.measurementLimitations.map((limitation, index) => (
                                        <li key={index}>{limitation}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    ))}
                </details>
            )}
        </div>
    );
}
