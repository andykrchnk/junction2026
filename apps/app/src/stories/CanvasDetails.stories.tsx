import type { Meta, StoryObj } from '@storybook/react-vite';
import { DetectedElementCard } from '@/features/drawings/detected-element-card';
const meta = {
    title: 'Official/Canvas/Element details',
    component: DetectedElementCard,
    args: { label: 'Storage', area: '≈12.4 m²', onClose: () => {} },
} satisfies Meta<typeof DetectedElementCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Room: Story = {};
export const WithoutArea: Story = { args: { label: 'Junction', area: 'Area unavailable' } };
