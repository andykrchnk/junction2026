import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionWorkshop } from '@/prototypes/session-workshop';
const meta = {
    title: 'Prototypes/Session tables',
    component: SessionWorkshop,
    args: { official: true, tableExperiment: true },
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SessionWorkshop>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Quiet: Story = { args: { initialVariant: 0 } };
export const Framed: Story = { args: { initialVariant: 1 } };
export const Ledger: Story = { args: { initialVariant: 2 } };
export const Roomy: Story = { args: { initialVariant: 3 } };
export const ColumnGrid: Story = { args: { initialVariant: 4 } };
