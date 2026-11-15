import { useId } from 'react';
import { useUnit } from 'effector-react';
import { Button } from '@repo/design-system/components/ui/button';
import { Input } from '@repo/design-system/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@repo/design-system/components/ui/dialog';
import type { PpmAdjustmentModel } from './ppm-adjustment-model';

export function PpmAdjustmentDialog({ model }: Readonly<{ model: PpmAdjustmentModel }>) {
    const { target, draft, error, saving, dismissed, areaChanged, saveRequested } = useUnit({
        target: model.$target,
        draft: model.$draft,
        error: model.$error,
        saving: model.$saving,
        dismissed: model.dismissed,
        areaChanged: model.areaChanged,
        saveRequested: model.saveRequested,
    });
    const inputId = useId();
    const errorId = `${inputId}-error`;

    return (
        <Dialog
            open={target !== null}
            onOpenChange={(open) => {
                if (!open) dismissed();
            }}
        >
            <DialogContent size="sm" className="p-5">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        saveRequested();
                    }}
                    className="space-y-4"
                >
                    <DialogHeader className="mb-0">
                        <DialogTitle className="pr-7">Adjust PPM</DialogTitle>
                        <DialogDescription>Use the known area of {target?.label ?? 'this object'} to update measurements on this sheet.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <label htmlFor={inputId} className="text-sm font-medium">
                            Area (m²)
                        </label>
                        <Input
                            id={inputId}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            value={draft}
                            onChange={(event) => areaChanged(event.target.value)}
                            disabled={saving}
                            autoFocus
                            required
                            aria-invalid={!!error}
                            aria-describedby={error ? errorId : undefined}
                        />
                        {error && (
                            <p id={errorId} role="alert" className="text-sm text-destructive">
                                {error}
                            </p>
                        )}
                    </div>
                    <DialogFooter className="mt-0">
                        <Button type="button" variant="secondary" onClick={dismissed} disabled={saving}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={saving}>
                            Save
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
