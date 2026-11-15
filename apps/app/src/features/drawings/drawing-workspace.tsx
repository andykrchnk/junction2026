import { createCanvasModel } from './canvas/model';
import { BlueprintLayersPanel } from './blueprint-layers-panel';
import { createCommentsModel } from './canvas/comments-model';
import { SessionChatPanel } from './session-chat-panel';
import { MAX_FILE_BYTES, type Drawing } from '@repo/types';
import { useDropzone } from 'react-dropzone';
import { useHotkeys } from 'react-hotkeys-hook';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { FileText, Upload } from '@repo/design-system/lib/icons-remix';
import { $$drawings } from './model';
import { Button } from '@repo/design-system/components/ui/button';
import { $$user } from '@/entities/user/model';
import { trpc } from '@/shared/trpc';
import { EntityClassEditor } from './entity-class-editor';

const BlueprintCanvas = lazy(() => import('./blueprint-canvas'));
export function WorkspacePanels({ id, userId, previewDrawing }: Readonly<{ id: string; userId: string; previewDrawing?: Drawing }>) {
    const { uploading, activity } = useUnit({ uploading: $$drawings.$uploading, activity: $$drawings.$activity });
    const {
        data: drawing,
        isPending,
        error,
    } = useQuery({
        ...trpc.drawings.get.queryOptions({ id }),
        enabled: !previewDrawing,
        initialData: previewDrawing,
        refetchInterval: (query) =>
            query.state.data?.busy ||
            (activity[id] ?? 0) > 0 ||
            query.state.data?.blueprints.some(
                (blueprint) =>
                    blueprint.status.type === 'processing' ||
                    [...(blueprint.layout?.rooms ?? []), ...(blueprint.layout?.fixtures ?? [])].some((entity) => entity.enrichment.type === 'processing'),
            )
                ? 1000
                : false,
    });
    const [canvasModel] = useState(() => createCanvasModel(id, `junction:canvas:${userId}:${id}`));
    const [commentsModel] = useState(() => createCommentsModel(id));
    const [chatCollapsed, setChatCollapsed] = useState<boolean>(false);
    const [layersCollapsed, setLayersCollapsed] = useState<boolean>(false);
    useHotkeys(
        'meta+backslash',
        (event) => {
            if (event.repeat) return;
            const collapsed = !(chatCollapsed && layersCollapsed);
            setChatCollapsed(collapsed);
            setLayersCollapsed(collapsed);
            event.stopPropagation();
        },
        { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true, eventListenerOptions: { capture: true } },
        [chatCollapsed, layersCollapsed],
    );
    const [localFile, setLocalFile] = useState<File | null>(null);
    const [localUrl, setLocalUrl] = useState('');
    const [uploadError, setUploadError] = useState('');
    const operationError = useUnit($$drawings.$error);
    const visibleError = uploadError || (operationError?.id === id ? operationError.message : null);
    useEffect(() => {
        if (!localFile) return;
        const url = URL.createObjectURL(localFile);
        setLocalUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [localFile]);
    function upload(files: File[]) {
        setUploadError('');
        if (previewDrawing) setLocalFile(files[0] ?? null);
        else $$drawings.uploadRequested({ id, files });
    }
    const { getRootProps, getInputProps, open } = useDropzone({
        accept: { 'application/pdf': ['.pdf'], 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] },
        multiple: true,
        minSize: 1,
        maxSize: MAX_FILE_BYTES,

        noClick: true,
        noKeyboard: true,
        onDropAccepted: (files) => {
            upload(files);
        },
        onDropRejected: () => setUploadError('Each file must be a PDF, PNG or JPG between 1 byte and 20 MB.'),
    });
    const dropProps = getRootProps();
    if (isPending)
        return (
            <p role="status" className="p-6 text-sm">
                Opening drawing…
            </p>
        );
    if (!drawing)
        return (
            <p role="alert" className="p-6 text-sm text-destructive">
                {error?.message ?? 'Drawing not found.'}
            </p>
        );
    const canvas = (
        <Suspense
            fallback={
                <p role="status" className="m-auto p-6 text-sm">
                    Loading canvas…
                </p>
            }
        >
            <BlueprintCanvas drawing={drawing} userId={userId} model={canvasModel} commentsModel={commentsModel} />
        </Suspense>
    );
    const uploadOverlay = !drawing.blueprints.length && (
        <div className="pointer-events-none flex h-full items-center justify-center p-8 text-center">
            {localUrl ? (
                <div className="pointer-events-auto flex h-full w-full flex-col gap-3">
                    <p className="text-xs text-muted-foreground">{localFile?.name} · Local preview, not analyzed</p>
                    {localFile?.type === 'application/pdf' ? (
                        <iframe title="Blueprint preview" src={localUrl} className="min-h-0 flex-1 w-full" />
                    ) : (
                        <img alt="Uploaded blueprint" src={localUrl} className="min-h-0 flex-1 object-contain" />
                    )}
                </div>
            ) : (
                <div className="pointer-events-auto w-full max-w-sm border bg-card p-8 text-card-foreground">
                    <FileText size={48} className="mx-auto mb-6 text-muted-foreground" aria-hidden />
                    <h2 className="text-xl font-medium">Upload your first blueprint</h2>
                    <p className="mt-3 text-sm text-muted-foreground">Drop floor plans here, or choose multiple documents to get started.</p>
                    <Button className="mt-6" leadingIcon={Upload} loading={uploading} onClick={open}>
                        Upload documents
                    </Button>
                    <p className="mt-4 text-xs text-muted-foreground">PDF, PNG or JPG · Up to 20 MB each · 10 pages per PDF</p>
                </div>
            )}
        </div>
    );
    return (
        <div
            className="relative isolate flex h-full min-h-0 flex-1 bg-muted/30"
            {...dropProps}
            onDropCapture={(event) => {
                if (event.dataTransfer.types.includes('Files')) {
                    event.stopPropagation();
                    event.preventDefault();
                    upload(Array.from(event.dataTransfer.files));
                }
            }}
            aria-disabled={undefined}
        >
            <input {...getInputProps({ 'aria-label': 'Upload documents' })} />
            {visibleError && (
                <p role="alert" className="absolute bottom-4 left-1/2 z-30 max-w-md whitespace-pre-wrap border bg-card p-3 text-sm text-destructive">
                    {visibleError}
                </p>
            )}
            <section aria-label="Blueprint canvas" className="absolute inset-0 z-0">
                {canvas}
            </section>
            <SessionChatPanel
                commentsModel={commentsModel}
                drawing={drawing}
                previewDrawing={previewDrawing}
                collapsed={chatCollapsed}
                setCollapsed={setChatCollapsed}
            />
            <div className="pointer-events-none relative z-10 min-h-0 min-w-0 flex-1">{uploadOverlay}</div>
            <BlueprintLayersPanel
                drawing={drawing}
                model={canvasModel}
                preview={!!previewDrawing}
                onUpload={open}
                uploading={false}
                collapsed={layersCollapsed}
                setCollapsed={setLayersCollapsed}
            />
            <EntityClassEditor drawing={drawing} model={canvasModel} preview={!!previewDrawing} />
        </div>
    );
}

export function DrawingWorkspace({ id }: Readonly<{ id: string }>) {
    const user = useUnit($$user.$user);
    if (!user) return null;
    return <WorkspacePanels key={`${user.id}:${id}`} id={id} userId={user.id} />;
}
