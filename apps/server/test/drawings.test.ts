import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import * as sdk from '@openai/agents';
import { Hono } from 'hono';
import { PDFDocument } from 'pdf-lib';
import type { TRPCContext } from '../src/shared/trpc';
import { AnswerZod, BlueprintZod, type Drawing } from '@repo/types';
import mongoose from 'mongoose';
import { z } from 'zod';

// Opt-in Atlas integration tests: only use a unique disposable database.
const enabled = Boolean(process.env.MONGODB_URI && process.env.RUN_DRAWING_TESTS);
const suite = enabled ? test : test.skip;
if (enabled) {
    process.env.MONGODB_DB_NAME = `junction_poc_test_${crypto.randomUUID().replaceAll('-', '')}`;
    process.env.OPENAI_API_KEY = 'test-key';
}
let fail = false;
const answerOutput = (text: string): z.infer<typeof AnswerZod> => ({
    text,
    references: [],
    status: 'answered',
    clarificationQuestion: null,
    userProvidedInformation: [],
});
let response: unknown = answerOutput('6 + 4 = 10 m² of floor tiling.');
if (!enabled) {
    const connection = mongoose.createConnection();
    mock.module('../src/db/connection', () => ({ connection }));
}
let captured: { input: unknown; instructions: unknown; history: sdk.AgentInputItem[] } | null = null;
const runMock = mock(async (agent: { instructions: unknown }, input: unknown, options: { session?: sdk.Session } = {}) => {
    captured = { input, instructions: agent.instructions, history: options.session ? await options.session.getItems() : [] };
    if (fail) throw new Error('Temporary provider failure');
    return { finalOutput: response };
});
mock.module('@openai/agents', () => ({ ...sdk, run: runMock }));
const context: TRPCContext = {
    authUser: { id: 'identity', email: 'poc@example.test' },
    session: { id: 'login', userId: 'identity', token: 'test', createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 100000) },
    user: {
        id: '111111111111111111111111',
        betterAuthUserId: 'identity',
        email: 'poc@example.test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
};
const blueprint = BlueprintZod.parse({
    id: 'sheet-1',
    pageNumber: 1,
    attachment: { id: '222222222222222222222222', name: 'synthetic.pdf', mediaType: 'application/pdf', pageNumber: 1 },
    raster: { fileId: '333333333333333333333333', width: 100, height: 100 },
    layout: {
        revision: 'test-revision',
        summary: 'Synthetic plan',
        rooms: [],
        fixtures: [],
        limitations: [],
        source: {
            prediction: { coordinate_system: 'image_pixels', image: { width: 100, height: 100 }, rooms: [], fixtures: [] },
            createdAt: new Date().toISOString(),
            degraded: [],
        },
    },
    misc: [{ title: 'Units', content: 'Areas are printed in square metres.' }],
    ppmCandidates: [],
    ppm: { message: 'No verified calibration.' },
    comments: [],
    status: { type: 'ready' },
});
const drawingFixture = (): Drawing => ({
    id: '111111111111111111111111',
    title: 'Synthetic drawing',
    updatedAt: new Date().toISOString(),
    status: 'ready',
    busy: false,
    error: null,
    blueprints: [blueprint],
    messages: [
        { id: crypto.randomUUID(), question: 'First question', answer: answerOutput('First reply') },
        { id: crypto.randomUUID(), question: 'Total floor tiling?', answer: null },
    ],
});

let caller: ReturnType<(typeof import('../src/features/drawings/router'))['drawingRouter']['createCaller']>;
let files: Hono<{ Variables: TRPCContext }>;
let drawingId = '';
beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET ??= 'synthetic-test-secret-at-least-32-characters';
    process.env.MONGODB_URI ??= 'mongodb://unused:27017';
    process.env.MONGODB_DB_NAME ??= 'unused';
    if (!enabled) return;
    const { drawingRouter } = await import('../src/features/drawings/router');
    const { drawingFiles } = await import('../src/features/drawings/files');
    const { DrawingModel } = await import('../src/db/drawing.schema');
    await DrawingModel.init();
    caller = drawingRouter.createCaller(context);
    files = new Hono<{ Variables: TRPCContext }>();
    files.use('*', async (c, next) => {
        c.set('user', context.user);
        c.set('session', context.session);
        await next();
    });
    files.route('/', drawingFiles);
});
afterAll(async () => {
    if (!enabled) return;
    const { connection } = await import('../src/db/connection');
    await connection.dropDatabase();
    await connection.close();
});

test('chat rehydrates history and receives blueprint inventory without image bytes', async () => {
    const { answer } = await import('../src/features/drawings/agent');
    response = answerOutput('6 + 4 = 10 m² of floor tiling.');
    expect((await answer(drawingFixture(), AbortSignal.timeout(1000))).text).toBe('6 + 4 = 10 m² of floor tiling.');
    expect(captured?.input).toBe('Total floor tiling?');
    expect(captured?.history).toHaveLength(2);
    expect(JSON.stringify(captured?.history)).toContain('First reply');
    expect(String(captured?.instructions)).toContain('Blueprint inventory:');
    expect(String(captured?.instructions)).toContain(blueprint.id);
    expect(JSON.stringify(captured)).not.toContain('data:');
    expect(JSON.stringify(captured)).not.toContain(blueprint.raster?.fileId);
});

test('blueprint inspection sends the canonical raster and validates context output', async () => {
    const { inspectBlueprint } = await import('../src/features/drawings/blueprint-agent');
    const contextOutput = { summary: 'Synthetic plan', misc: blueprint.misc ?? [], limitations: [] };
    response = contextOutput;
    const bytes = Buffer.from('synthetic raster bytes');
    expect(await inspectBlueprint(blueprint, bytes, AbortSignal.timeout(1000))).toEqual(contextOutput);
    expect(JSON.stringify(captured?.input)).toContain(`data:image/png;base64,${bytes.toString('base64')}`);
    response = { ...contextOutput, misc: [{ title: '', content: 'Invalid title' }] };
    await expect(inspectBlueprint(blueprint, bytes, AbortSignal.timeout(1000))).rejects.toThrow();
});

test('chat rejects unknown blueprint and entity references', async () => {
    const { answer } = await import('../src/features/drawings/agent');
    response = { ...answerOutput('Answer'), references: [{ blueprintId: 'missing-sheet', entityId: null }] };
    await expect(answer(drawingFixture(), AbortSignal.timeout(1000))).rejects.toThrow('Unknown blueprint reference');
    response = { ...answerOutput('Answer'), references: [{ blueprintId: blueprint.id, entityId: 'missing-entity' }] };
    await expect(answer(drawingFixture(), AbortSignal.timeout(1000))).rejects.toThrow('Invalid answer entity reference');
    response = { ...answerOutput('Answer'), references: [{ blueprintId: blueprint.id, entityId: null }] };
    expect((await answer(drawingFixture(), AbortSignal.timeout(1000))).references).toHaveLength(1);
});

test('chat requires a question only for clarification responses', async () => {
    const { answer } = await import('../src/features/drawings/agent');
    response = { ...answerOutput('Need dimensions'), status: 'needs_clarification' };
    await expect(answer(drawingFixture(), AbortSignal.timeout(1000))).rejects.toThrow('Invalid clarification response');
    response = { ...answerOutput('Answer'), clarificationQuestion: 'Which room?' };
    await expect(answer(drawingFixture(), AbortSignal.timeout(1000))).rejects.toThrow('Invalid clarification response');
    response = { ...answerOutput('Need dimensions'), status: 'needs_clarification', clarificationQuestion: 'What is the wall height?' };
    expect((await answer(drawingFixture(), AbortSignal.timeout(1000))).status).toBe('needs_clarification');
    response = answerOutput('6 + 4 = 10 m² of floor tiling.');
});

suite('auth, ownership and analysis gating are enforced on the server', async () => {
    const { drawingRouter } = await import('../src/features/drawings/router');
    const anonymous = drawingRouter.createCaller({ authUser: null, session: null, user: null });
    await expect(anonymous.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const drawing = await caller.create();
    drawingId = drawing.id;
    expect(drawing.status).toBe('empty');
    const stranger = drawingRouter.createCaller({ ...context, user: context.user ? { ...context.user, id: '222222222222222222222222' } : null });
    expect(await stranger.list()).toEqual([]);
    await expect(stranger.get({ id: drawingId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(stranger.analyze({ id: drawingId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(caller.ask({ id: drawingId, message: { id: crypto.randomUUID(), question: 'Area?' } })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
});
suite('upload validates contents and PDF pages; GridFS preserves the original', async () => {
    const upload = (file: File) => {
        const body = new FormData();
        body.set('file', file);
        return files.request(`/${drawingId}/file`, { method: 'POST', body });
    };
    expect((await upload(new File(['not a PDF'], 'plan.pdf', { type: 'application/pdf' }))).status).toBe(400);
    const tooLong = await PDFDocument.create();
    for (let i = 0; i < 11; i++) tooLong.addPage();
    expect((await upload(new File([new Uint8Array(await tooLong.save())], 'long.pdf'))).status).toBe(400);
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('Synthetic blueprint');
    const bytes = new Uint8Array(await pdf.save());
    expect((await upload(new File([bytes], 'plan.pdf'))).status).toBe(200);
    expect((await upload(new File([bytes], 'second.pdf'))).status).toBe(409);
    const downloaded = await files.request(`/${drawingId}/file`);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    expect((await caller.get({ id: drawingId })).status).toBe('uploaded');
});
suite('analysis requires inference and reuses completed blueprint context', async () => {
    await expect(caller.analyze({ id: drawingId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const { DrawingModel } = await import('../src/db/drawing.schema');
    await DrawingModel.updateOne({ _id: drawingId }, { $set: { blueprints: [blueprint] } });
    const count = runMock.mock.calls.length;
    const result = await caller.analyze({ id: drawingId });
    expect(result.status).toBe('ready');
    expect(result.blueprints).toEqual([blueprint]);
    expect((await caller.analyze({ id: drawingId })).blueprints).toEqual([blueprint]);
    expect(runMock.mock.calls.length).toBe(count);
});
suite('failed chat is durable, retries are idempotent, SDK history is restored', async () => {
    const { DrawingModel } = await import('../src/db/drawing.schema');
    await DrawingModel.updateOne({ _id: drawingId }, { $set: { blueprints: [blueprint] } });
    const message = { id: crypto.randomUUID(), question: 'How much floor tiling?' };
    fail = true;
    await expect(caller.ask({ id: drawingId, message })).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect((await caller.get({ id: drawingId })).messages).toEqual([{ ...message, answer: null }]);
    fail = false;
    const answered = await caller.ask({ id: drawingId, message });
    expect(answered.messages[0]?.answer?.text).toBe('6 + 4 = 10 m² of floor tiling.');
    const calls = runMock.mock.calls.length;
    expect((await caller.ask({ id: drawingId, message })).messages).toHaveLength(1);
    expect(runMock.mock.calls.length).toBe(calls);
    // A fresh caller rehydrates the same MongoDB conversation after a process boundary.
    const { drawingRouter } = await import('../src/features/drawings/router');
    const fresh = drawingRouter.createCaller(context);
    expect((await fresh.get({ id: drawingId })).messages).toEqual(answered.messages);
    response = answerOutput('Wall heights are missing; wall tiling cannot be determined.');
    const next = await fresh.ask({ id: drawingId, message: { id: crypto.randomUUID(), question: 'And the walls?' } });
    expect(next.messages).toHaveLength(2);
    expect(captured?.history).toHaveLength(2);
});
suite('expired operations recover and active operations reject concurrent requests', async () => {
    const { DrawingModel } = await import('../src/db/drawing.schema');
    await DrawingModel.updateOne({ _id: drawingId }, { $set: { lease: 'interrupted', leaseUntil: new Date(0) } });
    expect((await caller.get({ id: drawingId })).error).toContain('interrupted');
    response = answerOutput('Still 10 m².');
    expect((await caller.ask({ id: drawingId, message: { id: crypto.randomUUID(), question: 'Total again?' } })).busy).toBe(false);
    await DrawingModel.updateOne({ _id: drawingId }, { $set: { lease: 'another-worker', leaseUntil: new Date(Date.now() + 150000) } });
    await expect(caller.ask({ id: drawingId, message: { id: crypto.randomUUID(), question: 'Concurrent?' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await DrawingModel.updateOne({ _id: drawingId }, { $set: { lease: null, leaseUntil: null } });
});
suite('an old operation cannot commit after its lease is replaced', async () => {
    const { DrawingModel } = await import('../src/db/drawing.schema');
    const drawing = await caller.create();
    await DrawingModel.updateOne({ _id: drawing.id }, { $set: { blueprints: [blueprint] } });
    runMock.mockImplementationOnce(async () => {
        await DrawingModel.updateOne({ _id: drawing.id }, { $set: { lease: 'new-worker', leaseUntil: new Date(Date.now() + 150000) } });
        return { finalOutput: answerOutput('Stale answer') };
    });
    await expect(caller.ask({ id: drawing.id, message: { id: crypto.randomUUID(), question: 'Stale request' } })).rejects.toMatchObject({ code: 'CONFLICT' });
    const stored = await DrawingModel.findById(drawing.id).lean();
    expect(stored?.lease).toBe('new-worker');
    expect((await caller.get({ id: drawing.id })).messages[0]?.answer).toBeNull();
});
suite('invalid answer output is rejected before saving an answer', async () => {
    response = { text: 123 };
    await expect(caller.ask({ id: drawingId, message: { id: crypto.randomUUID(), question: 'Something else?' } })).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
    });
    expect((await caller.get({ id: drawingId })).messages.at(-1)?.answer).toBeNull();
});
