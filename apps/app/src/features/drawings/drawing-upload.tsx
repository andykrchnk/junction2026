import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { MAX_FILE_BYTES, type Drawing } from '@repo/types';
import { FileThumbnail, setPdfWorkerSrc } from '@repo/design-system/components/ui/file-thumbnail';
import { Input } from '@repo/design-system/components/ui/input';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';

setPdfWorkerSrc(pdfWorkerUrl);

type DrawingUploadParams = Readonly<{
    disabled: boolean;
    uploading: boolean;
    onUpload: (file: File) => void;
}>;

function FileDetails({ file, pending }: Readonly<{ file: File; pending: boolean }>) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <FileThumbnail file={file} size={56} />
            <div className="min-w-0 text-sm">
                <p className="break-words font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                    {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                    {pending && ' · Uploading…'}
                </p>
            </div>
        </div>
    );
}

export function DrawingUpload({ disabled, uploading, onUpload }: DrawingUploadParams) {
    const inputId = useId();
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="space-y-3">
            <div className="space-y-2">
                <label htmlFor={inputId} className="text-sm font-medium">
                    Upload a blueprint
                </label>
                <Input
                    id={inputId}
                    type="file"
                    accept="image/png,image/jpeg,application/pdf"
                    disabled={disabled || uploading}
                    aria-describedby={`${inputId}-help${error ? ` ${inputId}-error` : ''}`}
                    aria-invalid={Boolean(error)}
                    onChange={(event) => {
                        const selected = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (!selected) return;
                        if (!['image/png', 'image/jpeg', 'application/pdf'].includes(selected.type)) {
                            setError('Choose a PNG, JPEG or PDF file.');
                            return;
                        }
                        if (selected.size === 0 || selected.size > MAX_FILE_BYTES) {
                            setError(selected.size === 0 ? 'The selected file is empty.' : 'Choose a file smaller than 20 MB.');
                            return;
                        }
                        setError(null);
                        setFile(selected);
                        onUpload(selected);
                    }}
                />
                <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
                    PNG, JPEG or PDF · up to 20 MB. Analysis starts after upload.
                </p>
                {error && (
                    <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
                        {error}
                    </p>
                )}
            </div>
            {file && <FileDetails file={file} pending={uploading} />}
        </div>
    );
}

export function DrawingAttachmentThumbnail({ drawing }: Readonly<{ drawing: Drawing }>) {
    const attachment = drawing.blueprints[0]?.attachment;
    const name = attachment?.name;
    const mediaType = attachment?.mediaType;
    const { data, isError } = useQuery({
        queryKey: ['blueprint-file', drawing.id],
        enabled: Boolean(attachment),
        queryFn: async () => {
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/file`);
            if (!response.ok) throw new Error('Could not load blueprint.');
            return response.blob();
        },
    });
    const file = useMemo(() => (data && name && mediaType ? new File([data], name, { type: mediaType }) : null), [data, name, mediaType]);

    if (!attachment) return null;

    return (
        <div aria-label="Uploaded blueprint">
            {file ? (
                <FileDetails file={file} pending={false} />
            ) : (
                <div className="text-sm">
                    <p className="break-words font-medium">{attachment.name}</p>
                    <p className="text-xs text-muted-foreground" role={isError ? 'alert' : 'status'}>
                        {isError ? 'Could not load the file preview.' : 'Loading file preview…'}
                    </p>
                </div>
            )}
        </div>
    );
}
