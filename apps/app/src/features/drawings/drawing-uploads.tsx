import { useCallback, useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useUnit } from 'effector-react';
import type { Drawing, UpdateDrawingUpload } from '@repo/types';
import { Input } from '@repo/design-system/components/ui/input';
import { Button } from '@repo/design-system/components/ui/button';
import { DropdownMenu, DropdownTrigger, DropdownContent } from '@repo/design-system/components/ui/dropdown';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@repo/design-system/components/ui/dialog';
import { ScrollArea } from '@repo/design-system/components/ui/scroll-area';
import { MenuItem } from '@repo/design-system/components/ui/menu-item';
import { remixIcons } from '@repo/design-system/lib/icons-remix';
import { DrawingAttachmentThumbnail } from './drawing-upload';
import { $$drawings } from './model';
import { BlueprintContext } from './blueprint-context';

const MoreIcon = remixIcons['more-horizontal'];

export function DrawingUploads({ drawing, preview }: Readonly<{ drawing: Drawing; preview: boolean }>) {
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const actionsRef = useRef<HTMLButtonElement>(null);
    const restoreActionsFocus = useCallback((element: HTMLDivElement | null) => {
        // The menu item unmounts before the dialog; restore its durable trigger after exit.
        if (!element) requestAnimationFrame(() => actionsRef.current?.focus());
    }, []);
    const pending = useUnit($$drawings.updateUploadFx.pending);
    const attachment = drawing.blueprints[0]?.attachment;
    const update = async (change: Omit<UpdateDrawingUpload, 'id'>) => {
        setError(null);
        try {
            await $$drawings.updateUploadFx({ id: drawing.id, ...change });
            setRenaming(false);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not update upload.');
        }
    };
    const form = useForm({
        defaultValues: { name: '' },
        validators: { onSubmit: ({ value }) => (!value.name.trim() ? 'Enter an upload name.' : undefined) },
        onSubmit: async ({ value }) => {
            await update({ name: value.name.trim() });
        },
    });
    if (!attachment) return <p className="px-3 py-4 text-sm text-muted-foreground">Your uploaded blueprints will appear here.</p>;
    return (
        <div className="space-y-3 px-3 py-4">
            <BlueprintContext drawing={drawing} />
            <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                    <DrawingAttachmentThumbnail drawing={drawing} />
                </div>
                <DropdownMenu open={open} onOpenChange={setOpen}>
                    <DropdownTrigger
                        render={
                            <Button
                                ref={actionsRef}
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="-mr-2.5"
                                aria-label="Upload actions"
                                disabled={pending || preview}
                            >
                                <MoreIcon />
                            </Button>
                        }
                    />
                    <DropdownContent align="end">
                        <MenuItem
                            index={0}
                            label="Rename"
                            onSelect={() => {
                                form.reset({ name: attachment.name });
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
                        <MenuItem
                            index={2}
                            label="Info"
                            onSelect={() => {
                                setOpen(false);
                                setInfoOpen(true);
                            }}
                        />
                    </DropdownContent>
                </DropdownMenu>
            </div>
            <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
                <DialogContent ref={restoreActionsFocus} size="sm" className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-5">
                    <DialogHeader className="mb-0 shrink-0">
                        <DialogTitle className="pr-7">Upload info</DialogTitle>
                    </DialogHeader>
                    <ScrollArea
                        role="region"
                        aria-label="PPM information"
                        className="min-h-0"
                        style={{ maxHeight: 'calc(100dvh - 12rem)' }}
                        viewportClassName="max-h-[inherit] overscroll-contain"
                    >
                        <DialogDescription className="whitespace-pre-wrap break-words">
                            {drawing.blueprints[0]?.ppm ? (
                                <>
                                    {drawing.blueprints[0]?.ppm.value !== undefined && (
                                        <span className="mb-2 block font-medium text-foreground">PPM: {drawing.blueprints[0]?.ppm.value} px/m</span>
                                    )}
                                    {drawing.blueprints[0]?.ppm.message}
                                </>
                            ) : drawing.busy && !drawing.error && drawing.status !== 'failed' ? (
                                'PPM is not available. Drawing processing is in progress.'
                            ) : (
                                'PPM information is not available.'
                            )}
                        </DialogDescription>
                    </ScrollArea>
                    <DialogFooter className="mt-0 shrink-0">
                        <DialogClose
                            render={
                                <Button size="compact" variant="secondary">
                                    Close
                                </Button>
                            }
                        />
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {renaming && (
                <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void form.handleSubmit();
                    }}
                >
                    <form.Field name="name">
                        {(field) => (
                            <Input
                                autoFocus
                                aria-label="Upload name"
                                value={field.state.value}
                                maxLength={200}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                disabled={pending}
                                required
                            />
                        )}
                    </form.Field>
                    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
                        {(message) =>
                            message ? (
                                <p role="alert" className="text-sm text-destructive">
                                    {message}
                                </p>
                            ) : null
                        }
                    </form.Subscribe>
                    <div className="flex gap-2">
                        <Button type="submit" disabled={pending}>
                            Save
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
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
