import type { Meta, StoryObj } from '@storybook/react-vite';
import { DetectedElementCard } from '@/features/drawings/detected-element-card';
const meta = {
    title: 'Official/Canvas/Element details',
    component: DetectedElementCard,
    args: { property: { label: 'Storage', confidence: 0.81, areaPixels: 2244 }, page: 1, onClose: () => {} },
} satisfies Meta<typeof DetectedElementCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Room: Story = {};
export const WithoutArea: Story = { args: { property: { label: 'Junction', confidence: 0.94, areaPixels: null } } };
