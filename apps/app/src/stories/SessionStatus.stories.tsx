import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionStatus } from '@/components/session-dashboard/session-layouts';
const meta = {
    title: 'Official/Session status',
    component: SessionStatus,
    args: { status: 'Uploading', uploadProgress: 64 },
    argTypes: {
        status: { control: 'select', options: ['Uploading', 'Analyzing', 'Ready', 'Needs attention'] },
        uploadProgress: { control: { type: 'range', min: 0, max: 100, step: 1 } },
        rooms: { control: { type: 'number', min: 0 } },
    },
} satisfies Meta<typeof SessionStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Uploading: Story = {};
export const Analyzing: Story = { args: { status: 'Analyzing' } };
export const RoomsIdentified: Story = { args: { status: 'Ready', rooms: 6 } };
export const NoRooms: Story = { args: { status: 'Ready', rooms: 0 } };
export const NeedsAttention: Story = { args: { status: 'Needs attention' } };
