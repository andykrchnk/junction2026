import type { EntityStructuredDescription } from '@repo/types';

type FormatEntityDescriptionParams = Readonly<{ result: EntityStructuredDescription; kind: 'room' | 'fixture'; targetId: string }>;

// The display text is bounded; complete structured findings remain available in the database.
export function formatEntityDescription(params: FormatEntityDescriptionParams): string {
    const { result, kind, targetId } = params;
    const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
    const phrase = (text: string) => text.trim().replace(/[.;:]$/, '');
    const identity = result.name ?? result.interpretedClass;
    const identities = new Set([result.name, result.interpretedClass].filter((text) => text !== null).map(normalize));
    const reference = (id: string | null) => (id && id !== targetId ? ` [${id}]` : '');
    const finding = (item: EntityStructuredDescription['details']['windows'][number]) =>
        `${phrase(item.location)}: ${phrase(item.description)}${reference(item.objectId)}${item.source === 'inferred' ? ' (inferred)' : ''}`;
    const connectedIds = new Set(result.details.doors.flatMap((door) => door.connectedRoomIds ?? []));
    const describedIds = new Set(
        [...result.details.windows, ...result.details.doors, ...result.details.furniture].flatMap((item) => (item.objectId ? [item.objectId] : [])),
    );
    const lines = [
        identity,
        ...result.attributes
            .filter((attribute) => typeof attribute.value !== 'string' || !identities.has(normalize(attribute.value)))
            .map(
                (attribute) =>
                    `${attribute.name}: ${attribute.value}${attribute.unit ? ` ${attribute.unit}` : ''}${attribute.source === 'inferred' ? ' (inferred)' : ''}`,
            ),
        ...result.details.windows.map((item) => `Window — ${finding(item)}`),
        ...result.details.doors.map(
            (item) =>
                `Door — ${finding(item)} → ${item.connectedRoomIds === null ? 'outside' : item.connectedRoomIds.length ? item.connectedRoomIds.join(', ') : 'destination unknown'}`,
        ),
        ...result.details.furniture.map((item) => `Fixture — ${finding(item)}`),
        ...result.details.markings.map(
            (item) => `${item.text === null ? item.kind : `“${item.text}”`}: ${phrase(item.description)}; ${phrase(item.location)}${reference(item.objectId)}`,
        ),
        ...result.details.relatedObjects
            .filter((item) => item.objectId === null || (!connectedIds.has(item.objectId) && !describedIds.has(item.objectId)))
            .map((item) => `${item.relationship} — ${finding(item)}`),
        ...result.uncertainties.map((uncertainty) => `Uncertain: ${uncertainty}`),
    ].filter((line): line is string => line !== null && line.trim().length > 0);
    const distinct = [...new Map(lines.map((line) => [normalize(line), line])).values()];
    const description = distinct.join('\n') || 'No reliable target-specific findings.';
    const limit = kind === 'room' ? 1000 : 500;
    if (description.length <= limit) return description;
    const notice = '\nMore findings in structured details.';
    const available = limit - notice.length;
    const boundary = description.lastIndexOf('\n', available);
    const shortened = boundary > 0 ? description.slice(0, boundary) : description.slice(0, available).replace(/\s+\S*$/, '');
    return shortened + notice;
}
