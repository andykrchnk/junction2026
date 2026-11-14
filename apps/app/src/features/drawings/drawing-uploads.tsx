import { useState } from 'react';
import { useUnit } from 'effector-react';
import type { Drawing, UpdateDrawingUpload } from '@repo/types';
import { Input } from '@repo/design-system/components/ui/input';
import { Button } from '@repo/design-system/components/ui/button';
import { DropdownMenu, DropdownTrigger, DropdownContent } from '@repo/design-system/components/ui/dropdown';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { remixIcons } from '@repo/design-system/lib/icons-remix';
import { DrawingAttachmentThumbnail } from './drawing-upload';
import { $$drawings } from './model';

const MoreIcon = remixIcons['more-horizontal'];

export function DrawingUploads({ drawing, preview }: Readonly<{ drawing: Drawing; preview: boolean }>) {
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const pending = useUnit($$drawings.updateUploadFx.pending);
    const attachment = drawing.attachment;
    const update = async (change: Omit<UpdateDrawingUpload, 'id'>) => {
        setError(null);
        try {
            await $$drawings.updateUploadFx({ id: drawing.id, ...change });
            setRenaming(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not update upload.');
        }
    };
    if (!attachment) return <p className="p-4 text-sm text-muted-foreground">Your uploaded blueprints will appear here.</p>;
    return (
        <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <DrawingAttachmentThumbnail drawing={drawing} />
                </div>
                <DropdownMenu open={open} onOpenChange={setOpen}>
                    <DropdownTrigger
                        render={
                            <Button variant="ghost" size="icon" aria-label="Upload actions" disabled={pending || preview}>
                                <MoreIcon />
                            </Button>
                        }
                    />
                    <DropdownContent align="end">
                        <MenuItem
                            index={0}
                            label="Rename"
                            onSelect={() => {
                                setName(attachment.name);
                                setRenaming(true);
                                setOpen(false);
                            }}
                        />
                        <MenuItem
                            index={1}
                            label={attachment.hiddenFromCanvas ? 'Restore to canvas' : 'Remove from canvas'}
                            onSelect={() => {
                                setOpen(false);
                                void update({ hiddenFromCanvas: !attachment.hiddenFromCanvas });
                            }}
                        />
                    </DropdownContent>
                </DropdownMenu>
            </div>
            {renaming && (
                <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (name.trim()) void update({ name });
                    }}
                >
                    <Input
                        autoFocus
                        aria-label="Upload name"
                        value={name}
                        maxLength={200}
                        onChange={(event) => setName(event.target.value)}
                        disabled={pending}
                    />
                    <div className="flex gap-2">
                        <Button type="submit" disabled={pending || !name.trim()}>
                            Save
                        </Button>
                        <Button variant="ghost" onClick={() => setRenaming(false)}>
                            Cancel
                        </Button>
                    </div>
                </form>
            )}
            {attachment.hiddenFromCanvas && <p className="text-xs text-muted-foreground">Removed from canvas. The upload and analysis are saved.</p>}
            {error && (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            )}
        </div>
    );
}
