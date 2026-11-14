import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from 'next-themes';
import type { DrawingSummary } from '@repo/types';
import { FileText } from '@repo/design-system/lib/icons-remix';
import { authenticatedFetch } from '@/shared/auth';
import { config } from '@/shared/config';

export function DrawingCover({ drawing }: Readonly<{ drawing: DrawingSummary }>) {
    const { resolvedTheme } = useTheme();
    const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
    const fileId = theme === 'dark' ? drawing.covers?.darkFileId : drawing.covers?.lightFileId;
    const [preview, setPreview] = useState<Readonly<{ blob: Blob; url: string }> | null>(null);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const { data: blob } = useQuery({
        queryKey: ['drawing-cover', drawing.id, fileId ?? null, theme],
        enabled: Boolean(fileId && resolvedTheme),
        staleTime: Infinity,
        queryFn: async ({ signal }) => {
            const response = await authenticatedFetch(`${config.API_URL}/api/drawings/${drawing.id}/covers/${theme}`, { signal });
            if (!response.ok) throw new Error('Could not load the session cover.');
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

    if (!resolvedTheme || !fileId || !preview || preview.blob !== blob || preview.url === failedUrl) {
        return <FileText size={48} aria-label="Drawing document" />;
    }
    return (
        <img src={preview.url} alt={`${drawing.title} room outline cover`} className="h-full w-full object-contain" onError={() => setFailedUrl(preview.url)} />
    );
}
