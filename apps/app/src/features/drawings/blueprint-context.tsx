import type { Drawing } from '@repo/types';

export function BlueprintContext({ drawing }: Readonly<{ drawing: Drawing }>) {
    return (
        <div className="space-y-3">
            {drawing.blueprints.map((blueprint) => (
                <details key={blueprint.id} className="border-t pt-3 text-sm">
                    <summary className="cursor-pointer font-medium">Sheet {blueprint.pageNumber} · Drawing context</summary>
                    <div className="mt-3 space-y-3">
                        {blueprint.layout?.summary && <p>{blueprint.layout.summary}</p>}
                        {blueprint.misc === null && <p className="text-xs text-muted-foreground">General notes have not been analyzed yet.</p>}
                        {blueprint.misc?.map((entry, index) => (
                            <div key={index}>
                                <p className="font-medium">{entry.title}</p>
                                <p className="whitespace-pre-wrap text-muted-foreground">{entry.content}</p>
                            </div>
                        ))}
                        {blueprint.ppm && (
                            <div>
                                <p className="font-medium">
                                    {blueprint.ppm.value ? `Estimated scale · ${blueprint.ppm.value.toLocaleString()} px/m` : 'Scale unresolved'}
                                </p>
                                <p className="text-xs text-muted-foreground">{blueprint.ppm.message}</p>
                            </div>
                        )}
                        {!!blueprint.layout?.limitations.length && (
                            <div>
                                <p className="font-medium">Limitations</p>
                                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                                    {blueprint.layout.limitations.map((limitation, index) => (
                                        <li key={index}>{limitation}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </details>
            ))}
        </div>
    );
}
