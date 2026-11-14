import mongoose from 'mongoose';
import { z } from 'zod';
import {
    AttachmentZod,
    DrawingCoversZod,
    BlueprintZod,
    LayoutRoomZod,
    LayoutFixtureZod,
    DetectedPropertyZod,
    MessageZod,
    PpmCandidatesZod,
    ProcessingPredictionZod,
    ScanCommentZod,
    StoredPpmResultZod,
    type Blueprint,
} from '@repo/types';
import { connection, database } from '../connection';
import { createBlueprints, layoutFromPrediction } from '../drawing.schema';

const OldPageZod = z.object({
    page: z.number().int().positive(),
    rasterFileId: z.string(),
    width: z.number().positive(),
    height: z.number().positive(),
    raw: z.unknown(),
    detectedProperties: z.array(DetectedPropertyZod.extend({ id: z.string().optional() })),
    createdAt: z.string(),
});
const ExistingBlueprintZod = z
    .object({
        raster: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).passthrough().nullable(),
        layout: z
            .object({
                rooms: z.array(LayoutRoomZod),
                fixtures: z.array(
                    z.preprocess((value) => {
                        const parsed = z.record(z.string(), z.unknown()).safeParse(value);
                        if (!parsed.success) return value;
                        const { room_ids, ...fixture } = parsed.data;
                        return { ...fixture, roomIds: fixture.roomIds ?? room_ids };
                    }, LayoutFixtureZod),
                ),
                source: z.object({ prediction: z.unknown() }).passthrough(),
            })
            .passthrough()
            .nullable(),
    })
    .passthrough();

const OldDrawingZod = z.object({
    _id: z.instanceof(mongoose.Types.ObjectId),
    ownerId: z.string(),
    updatedAt: z.date(),
    inferenceLease: z.string().nullable().default(null),
    inferenceLeaseUntil: z.date().nullable().default(null),
    lease: z.string().nullable().default(null),
    leaseUntil: z.date().nullable().default(null),
    error: z.string().nullable().default(null),
    blueprints: z.array(ExistingBlueprintZod).optional(),
    covers: DrawingCoversZod.nullable().default(null),
    attachment: AttachmentZod.nullable().default(null),
    detection: z
        .object({ pages: z.array(OldPageZod) })
        .nullable()
        .default(null),
    ppmCandidates: PpmCandidatesZod.nullable().default(null),
    ppm: StoredPpmResultZod.nullable().default(null),
    comments: z.array(z.record(z.string(), z.unknown())).default([]),
    messages: z
        .array(
            z.object({
                id: z.string().uuid(),
                question: z.string(),
                answer: z
                    .object({
                        text: z.string(),
                        status: z.enum(['answered', 'needs_clarification', 'cannot_determine']).optional(),
                        clarificationQuestion: z.string().nullable().optional(),
                        userProvidedInformation: z.array(z.string()).optional(),
                        references: z.array(z.object({ blueprintId: z.string(), entityId: z.string().nullable() })).optional(),
                    })
                    .nullable(),
            }),
        )
        .default([]),
});

export function migrateBlueprints(data: unknown): Blueprint[] {
    const drawing = OldDrawingZod.parse(data);
    if (drawing.blueprints)
        return drawing.blueprints.map((blueprint) => {
            const { layout, raster } = blueprint;
            if (!layout || !raster || ProcessingPredictionZod.safeParse(layout.source.prediction).success) return BlueprintZod.parse(blueprint);
            // Intermediate blueprint records retained CubiCasa source data. Rebuild the standardized
            // source from their already normalized geometry without changing IDs or enrichment.
            const prediction = ProcessingPredictionZod.parse({
                coordinate_system: 'image_pixels',
                image: { width: raster.width, height: raster.height },
                rooms: layout.rooms.map(({ id, class: label, confidence, name, geometry, measurements }) => ({
                    id,
                    class: label,
                    confidence,
                    name,
                    geometry,
                    measurements,
                })),
                fixtures: layout.fixtures.map(({ id, class: label, confidence, roomIds, geometry, measurements }) => ({
                    id,
                    class: label,
                    confidence,
                    room_ids: roomIds,
                    geometry,
                    measurements,
                })),
            });
            return BlueprintZod.parse({ ...blueprint, layout: { ...layout, source: { ...layout.source, prediction } } });
        });
    if (!drawing.attachment) return [];
    const comments = drawing.comments.map((comment) => {
        const application = comment.application ?? comment.type;
        const type = comment.type === 'annotation' || comment.type === 'comment' ? comment.type : comment.source === 'ppm' ? 'annotation' : 'comment';
        return ScanCommentZod.parse({ ...comment, application, type });
    });
    return createBlueprints(drawing.attachment).map((blueprint) => {
        const page = drawing.detection?.pages.find((item) => item.page === blueprint.pageNumber);
        const supplied = page ? ProcessingPredictionZod.safeParse(page.raw) : null;
        const raw = page
            ? supplied?.success
                ? supplied.data
                : ProcessingPredictionZod.parse({
                      coordinate_system: 'image_pixels',
                      image: { width: page.width, height: page.height },
                      rooms: page.detectedProperties.flatMap((property, index) => {
                          if (property.type !== 'room') return [];
                          const room = ProcessingPredictionZod.shape.rooms.element.safeParse({
                              id: `room-${index}`,
                              class: property.label,
                              confidence: property.confidence,
                              name: null,
                              geometry: property.geometry,
                          });
                          return room.success ? [room.data] : [];
                      }),
                      fixtures: page.detectedProperties.flatMap((property, index) => {
                          if (property.type !== 'icon') return [];
                          const fixture = ProcessingPredictionZod.shape.fixtures.element.safeParse({
                              id: `fixture-${index}`,
                              class: property.label,
                              confidence: property.confidence,
                              room_ids: [],
                              geometry: property.geometry,
                          });
                          return fixture.success ? [fixture.data] : [];
                      }),
                  })
            : null;
        const layout =
            page && raw
                ? layoutFromPrediction({
                      ...page,
                      detectedProperties: page.detectedProperties.map((property, index) => ({ ...property, id: property.id ?? `candidate-${index}` })),
                      raw,
                      coordinateSystem: 'uploaded_raster_pixels_top_left',
                  })
                : null;
        if (layout && !supplied?.success)
            layout.limitations.push('Converted older polygon detections. Unsupported candidates were omitted; room relationships require review.');
        const pageComments = comments
            .filter((comment) => comment.page === blueprint.pageNumber)
            .map((comment) => {
                if (comment.application !== 'entity' || !page || !layout) return comment;
                const entities = [...layout.rooms, ...layout.fixtures];
                const id = comment.roomId ?? comment.fixtureId;
                if (entities.some((entity) => entity.id === id)) return comment;
                const index = page.detectedProperties.findIndex(
                    (property, index) => id === `${page.page}:${property.type === 'room' ? 'room' : 'fixture'}:${index}`,
                );
                const property = page.detectedProperties[index];
                const entity = supplied?.success
                    ? property?.type === 'room'
                        ? supplied.data.rooms[index]
                        : supplied.data.fixtures[index - supplied.data.rooms.length]
                    : entities.find((entity) => entity.id === `${property?.type === 'room' ? 'room' : 'fixture'}-${index}`);
                if (entity)
                    return { ...comment, roomId: property?.type === 'room' ? entity.id : null, fixtureId: property?.type === 'icon' ? entity.id : null };
                const anchor = property?.centroid ?? property?.bbox?.slice(0, 2);
                if (!anchor) throw new Error('An old entity comment cannot be associated with a layout object or image position.');
                return {
                    ...comment,
                    application: 'point',
                    x: Math.max(0, Math.min(1, anchor[0] / page.width)),
                    y: Math.max(0, Math.min(1, anchor[1] / page.height)),
                };
            });
        return BlueprintZod.parse({
            ...blueprint,
            layout,
            raster: page ? { fileId: page.rasterFileId, width: page.width, height: page.height } : null,
            ppmCandidates: drawing.ppmCandidates?.filter((candidate) => candidate.page === blueprint.pageNumber) ?? null,
            ppm: drawing.attachment?.pages === 1 ? drawing.ppm : null,
            comments: pageComments,
        });
    });
}

// bun --env-file=.env apps/server/src/db/migrations/blueprint-context.ts [--apply]
// Explicit migration only; application requests never convert old records.
if (import.meta.main) {
    const apply = Bun.argv.includes('--apply');
    try {
        const documents = await database
            .collection('drawings')
            .find({
                $or: [
                    { blueprints: { $exists: false } },
                    ...['inferenceLease', 'inferenceLeaseUntil', 'lease', 'leaseUntil', 'error'].map((field) => ({ [field]: { $exists: false } })),
                    { schemaVersion: { $exists: true } },
                    { legacyContext: { $exists: true } },
                    { attachment: { $exists: true } },
                    { detection: { $exists: true } },
                    { analysis: { $exists: true } },
                ],
            })
            .toArray();
        const changes = documents.map((document) => {
            const parsed = OldDrawingZod.parse(document);
            return {
                document: parsed,
                blueprints: migrateBlueprints(document),
                messages: parsed.messages.map((message) =>
                    MessageZod.parse({
                        ...message,
                        answer: message.answer
                            ? {
                                  ...message.answer,
                                  status: message.answer.status ?? 'answered',
                                  clarificationQuestion: message.answer.clarificationQuestion ?? null,
                                  userProvidedInformation: message.answer.userProvidedInformation ?? [],
                                  references: message.answer.references ?? [],
                              }
                            : null,
                    }),
                ),
            };
        });
        if (apply)
            for (const change of changes) {
                const result = await database.collection('drawings').updateOne(
                    {
                        _id: change.document._id,
                        ownerId: change.document.ownerId,
                        updatedAt: change.document.updatedAt,
                        $and: [
                            { $or: [{ lease: null }, { leaseUntil: { $lte: new Date() } }] },
                            { $or: [{ inferenceLease: null }, { inferenceLeaseUntil: { $lte: new Date() } }] },
                        ],
                    },
                    {
                        $set: {
                            blueprints: change.blueprints,
                            messages: change.messages,
                            covers: change.document.covers,
                            inferenceLease: change.document.inferenceLease,
                            inferenceLeaseUntil: change.document.inferenceLeaseUntil,
                            lease: change.document.lease,
                            leaseUntil: change.document.leaseUntil,
                            error: change.document.error,
                            updatedAt: new Date(),
                        },
                        $unset: {
                            schemaVersion: '',
                            legacyContext: '',
                            attachment: '',
                            analysis: '',
                            detection: '',
                            ppmCandidates: '',
                            ppm: '',
                            comments: '',
                        },
                    },
                );
                if (!result.matchedCount) throw new Error('A drawing changed or is processing. Rerun the migration after it finishes.');
            }
        console.log(
            JSON.stringify({
                mode: apply ? 'apply' : 'dry-run',
                drawings: changes.length,
                blueprints: changes.reduce((sum, change) => sum + change.blueprints.length, 0),
            }),
        );
    } finally {
        await connection.close();
    }
}
