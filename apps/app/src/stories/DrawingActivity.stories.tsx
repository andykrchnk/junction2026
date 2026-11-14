import type { Meta, StoryObj } from '@storybook/react-vite';
import { DrawingActivity } from '@/features/drawings/drawing-activity';
const meta = {
    title: 'Official/Canvas/Activity',
    component: DrawingActivity,
    args: { label: 'Uploading blueprint' },
    decorators: [
        (Story) => (
            <div className="w-80 border bg-card p-4">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof DrawingActivity>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Uploading: Story = {};
export const Detecting: Story = { args: { label: 'Detecting rooms and objects' } };
export const Reviewing: Story = { args: { label: 'Reviewing blueprint' } };
export const Answering: Story = { args: { label: 'Reviewing blueprint evidence' } };
