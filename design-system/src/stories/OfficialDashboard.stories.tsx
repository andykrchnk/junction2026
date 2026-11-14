import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionWorkshop } from '../prototypes/session-workshop';
const meta = { title: 'Official/Dashboard', component: SessionWorkshop, args: { official: true }, parameters: { layout: 'fullscreen' } } satisfies Meta<
    typeof SessionWorkshop
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Balanced: Story = {};

export const QuietTable: Story = { args: { initialTable: true } };
