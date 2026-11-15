import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import type { DrawingSummary } from '@repo/types';
import { DrawingPlaceholder } from '@/shared/components/drawing-placeholder';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';

export function DrawingCover({ drawing }: Readonly<{ drawing: DrawingSummary }>) {
    const { resolvedTheme } = useTheme();
    const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
    const fileId = theme === 'dark' ? drawing.covers?.darkFileId : drawing.covers?.lightFileId;
    const [preview, setPreview] = useState<Readonly<{ blob: Blob; url: string }> | null>(null);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const { data: blob } = useQuery({
        queryKey: ['drawing-workspace-preview', drawing.id, drawing.updatedAt, theme],
        enabled: Boolean(drawing.documentCount && resolvedTheme),
        staleTime: Infinity,
        queryFn: async ({ signal }) => {
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/workspace-preview/${theme}`, { signal });
            if (!response.ok) {
                if (!fileId) throw new Error('Preview not available yet.');
                const fallback = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/covers/${theme}`, { signal });
                if (!fallback.ok) throw new Error('Could not load the session cover.');
                return fallback.blob();
            }
            return response.blob();
        },
    });
    useEffect(() => {
        if (!blob) {
            setPreview(null);
            return;
        }
        const url = URL.createObjectURL(blob);
        setPreview({ blob, url });
        return () => URL.revokeObjectURL(url);
    }, [blob]);

    if (!resolvedTheme || !preview || preview.blob !== blob || preview.url === failedUrl) {
        return <DrawingPlaceholder />;
    }
    return (
        <img
            src={preview.url}
            alt={`${drawing.title} workspace preview`}
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setFailedUrl(preview.url)}
        />
    );
}
