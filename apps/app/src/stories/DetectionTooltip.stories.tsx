import type { Meta, StoryObj } from '@storybook/react-vite';
import { DETECTED_OBJECT_COLORS } from '@repo/types';
import { DetectedObjectTooltipCard } from '@/features/drawings/detected-object-tooltip-card';

const meta = {
    title: 'Official/Canvas/Detection tooltip',
    component: DetectedObjectTooltipCard,
    args: { label: 'Kitchen', area: '≈5.675 m²', confidence: 0.62 },
    decorators: [
        (Story) => (
            <div style={{ display: 'inline-block', borderRadius: 4, backgroundColor: DETECTED_OBJECT_COLORS.room.Kitchen }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof DetectedObjectTooltipCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Kitchen: Story = {};
export const HighConfidence: Story = { args: { confidence: 0.98 } };
export const AreaUnavailable: Story = { args: { area: 'Area unavailable' } };
