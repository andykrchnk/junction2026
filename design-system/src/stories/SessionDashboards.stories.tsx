import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionWorkshop } from '../prototypes/session-workshop';
const meta = { title: 'Prototypes/Session dashboards', component: SessionWorkshop, parameters: { layout: 'fullscreen' } } satisfies Meta<
    typeof SessionWorkshop
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const QuietList: Story = { args: { initialVariant: 0 } };
export const PlanLibrary: Story = { args: { initialVariant: 1 } };
export const UploadFirst: Story = { args: { initialVariant: 2 } };
export const Workspace: Story = { args: { initialVariant: 3 } };
export const SessionIndex: Story = { args: { initialVariant: 4 } };
