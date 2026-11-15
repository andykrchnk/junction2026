import { useState, type ComponentProps, type ReactNode } from 'react';
import {
    TraceLine,
    TraceTitle,
    TraceDescription,
    TraceIcon,
    TraceCollapsible,
    TraceCollapsibleTrigger,
    TraceCollapsibleContent,
} from '@repo/design-system/components/ui/trace';
export type TraceStatus = ComponentProps<typeof TraceLine>['status'];

export function ProgressStep({
    title,
    status,
    detail,
    icon,
    children,
}: Readonly<{ title: string; status: TraceStatus; detail: string; icon?: ReactNode; children: ReactNode }>) {
    const [open, setOpen] = useState(false);
    return (
        <TraceCollapsible open={open} onOpenChange={setOpen}>
            <TraceCollapsibleTrigger className="w-full">
                <TraceLine status={status} className="flex-1">
                    {icon && <TraceIcon>{icon}</TraceIcon>}
                    <TraceTitle title={title}>{title}</TraceTitle>
                    <TraceDescription className="ml-auto text-xs">{detail}</TraceDescription>
                </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent className="space-y-2 text-xs whitespace-pre-wrap">{children}</TraceCollapsibleContent>
        </TraceCollapsible>
    );
}
