import type { Drawing } from '@repo/types';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUnit } from 'effector-react';
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar } from '@repo/design-system/components/ui/sidebar';
import { FileText, Upload } from '@repo/design-system/lib/icons-remix';
import { $$drawings } from './model';
import { Button } from '@repo/design-system/components/ui/button';
import { $$user } from '@/entities/user/model';
import { trpc } from '@/shared/trpc';
import { DrawingChat } from './drawing-chat';

const BlueprintCanvas = lazy(() => import('./blueprint-canvas'));
function ExpandChat() {
    const { open, isMobile } = useSidebar();
    if (open && !isMobile) return null;
    return (
        <div className="absolute left-3 top-3 z-10">
            <SidebarTrigger />
        </div>
    );
}

export function WorkspacePanels({ id, userId, previewDrawing }: Readonly<{ id: string; userId: string; previewDrawing?: Drawing }>) {
    const {
        data: drawing,
        isPending,
        error,
    } = useQuery({
        ...trpc.drawings.get.queryOptions({ id }),
        enabled: !previewDrawing,
        initialData: previewDrawing,
        refetchInterval: (query) => (query.state.data?.detection?.status === 'processing' ? 2000 : false),
    });
    const picker = useRef<HTMLInputElement>(null);
    const [localFile, setLocalFile] = useState<File | null>(null);
    const [localUrl, setLocalUrl] = useState('');
    const [uploadError, setUploadError] = useState('');
    const uploading = useUnit($$drawings.$uploading);
    useEffect(() => {
        if (!localFile) return;
        const url = URL.createObjectURL(localFile);
        setLocalUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [localFile]);
    function upload(file: File) {
        if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) {
            setUploadError('Choose a PDF, PNG or JPG up to 20 MB.');
            return;
        }
        setUploadError('');
        if (previewDrawing) setLocalFile(file);
        else
            void $$drawings
                .uploadFx({ id, file })
                .catch((error: unknown) => setUploadError(error instanceof Error ? error.message : 'Upload failed. Please retry.'));
    }
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
    const canvas = drawing.attachment ? (
        <Suspense
            fallback={
                <p role="status" className="m-auto p-6 text-sm">
                    Loading canvas…
                </p>
            }
        >
            <BlueprintCanvas drawing={drawing} userId={userId} />
        </Suspense>
    ) : (
        <div
            className="flex h-full items-center justify-center p-8 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
                event.preventDefault();
                if (!uploading && event.dataTransfer.files[0]) upload(event.dataTransfer.files[0]);
            }}
        >
            {localUrl ? (
                <div className="flex h-full w-full flex-col gap-3">
                    <p className="text-xs text-muted-foreground">{localFile?.name} · Local preview, not analyzed</p>
                    {localFile?.type === 'application/pdf' ? (
                        <iframe title="Blueprint preview" src={localUrl} className="min-h-0 flex-1 w-full" />
                    ) : (
                        <img alt="Uploaded blueprint" src={localUrl} className="min-h-0 flex-1 object-contain" />
                    )}
                </div>
            ) : (
                <div className="max-w-sm">
                    <FileText size={48} className="mx-auto mb-6 text-muted-foreground" aria-hidden />
                    <h2 className="text-xl font-medium">Upload your first blueprint</h2>
                    <p className="mt-3 text-sm text-muted-foreground">Drop a floor plan here, or choose a file to get started.</p>
                    <Button className="mt-6" leadingIcon={Upload} loading={uploading} onClick={() => picker.current?.click()}>
                        Upload floor plan
                    </Button>
                    <p className="mt-4 text-xs text-muted-foreground">PDF, PNG or JPG · Up to 20 MB</p>
                    {previewDrawing && <p className="mt-2 text-xs text-muted-foreground">Local preview · Files stay in this browser.</p>}
                </div>
            )}
            <input
                ref={picker}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label="Upload floor plan"
                accept="application/pdf,image/png,image/jpeg"
                disabled={uploading}
                onChange={(event) => {
                    if (event.currentTarget.files?.[0]) upload(event.currentTarget.files[0]);
                    event.currentTarget.value = '';
                }}
            />
            {uploadError && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                    {uploadError}
                </p>
            )}
        </div>
    );
    return (
        <SidebarProvider width="360px" peek="hover" persist={false} className="!min-h-0 h-full flex-1 bg-muted/30">
            <Sidebar variant="floating" className="!h-full">
                <DrawingChat id={id} previewDrawing={previewDrawing} />
            </Sidebar>
            <section aria-label="Blueprint canvas" className="relative min-h-0 min-w-0 flex-1">
                <ExpandChat />
                {canvas}
            </section>
        </SidebarProvider>
    );
}

export function DrawingWorkspace({ id }: Readonly<{ id: string }>) {
    const user = useUnit($$user.$user);
    if (!user) return null;
    return <WorkspacePanels key={`${user.id}:${id}`} id={id} userId={user.id} />;
}
