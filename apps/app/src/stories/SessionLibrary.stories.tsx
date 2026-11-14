import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionLayouts } from '@/components/session-dashboard/session-layouts';
const sessions = [
    {
        id: 3,
        name: 'Workshop extension',
        file: 'Proposed plan.pdf',
        status: 'Uploading',
        uploadProgress: 64,
        createdAt: '2026-11-14T10:00:00Z',
        documentCount: 1,
    },
    { id: 2, name: 'Northside residence', file: 'First floor.pdf', status: 'Analyzing', createdAt: '2026-11-13T10:00:00Z', documentCount: 4 },
    { id: 1, name: 'Garden studio', file: 'Studio plan.png', status: 'Ready', rooms: 3, createdAt: '2026-11-12T10:00:00Z', documentCount: 1 },
];
const meta = {
    title: 'Official/Session library',
    component: SessionLayouts,
    parameters: { layout: 'fullscreen' },
    args: { variant: 0, sessions, onNew: () => {}, onOpen: () => {}, onSignOut: () => {} },
    argTypes: { onNew: { action: 'new-session' }, onOpen: { action: 'open-session' }, onSignOut: { action: 'log-out' } },
    render: (args) => <SessionLayouts key={`${args.initialTable}-${args.loading}`} {...args} />,
} satisfies Meta<typeof SessionLayouts>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Cards: Story = {};
export const QuietTable: Story = { args: { initialTable: true } };
export const Empty: Story = { args: { sessions: [] } };
export const Loading: Story = { args: { sessions: [], loading: true } };
export const Error: Story = { args: { sessions: [], error: 'Could not load your sessions. Please try again.' } };
