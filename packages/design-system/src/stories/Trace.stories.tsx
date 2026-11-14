import { Trace, TraceLine, TraceTitle, TraceCollapsible, TraceCollapsibleTrigger, TraceCollapsibleContent } from '../components/ui/trace';
export default { title: 'Current/Trace' };
export const Reasoning = {
    render: () => (
        <Trace className="w-80">
            <TraceCollapsible defaultOpen>
                <TraceCollapsibleTrigger>
                    <TraceLine status="running">
                        <TraceTitle>Reviewing blueprint</TraceTitle>
                    </TraceLine>
                </TraceCollapsibleTrigger>
                <TraceCollapsibleContent className="space-y-2 text-sm">
                    <TraceLine>
                        <TraceTitle>Blueprint uploaded</TraceTitle>
                    </TraceLine>
                    <TraceLine>
                        <TraceTitle>Rooms and objects detected</TraceTitle>
                    </TraceLine>
                    <TraceLine status="running">
                        <TraceTitle>Reviewing blueprint evidence</TraceTitle>
                    </TraceLine>
                </TraceCollapsibleContent>
            </TraceCollapsible>
        </Trace>
    ),
};
