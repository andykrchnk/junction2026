import type { Meta, StoryObj } from '@storybook/react-vite';
import { SessionWorkshop } from '../prototypes/session-workshop';
const meta = { title: 'Prototypes/Session dashboards', component: SessionWorkshop, parameters: { layout: 'fullscreen' } } satisfies Meta<
    typeof SessionWorkshop
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Balanced: Story = { args: { initialVariant: 0 } };
export const FiveAcross: Story = { args: { initialVariant: 1 } };
export const OpenGallery: Story = { args: { initialVariant: 2 } };
export const DrawingSheets: Story = { args: { initialVariant: 3 } };
export const WideLibrary: Story = { args: { initialVariant: 4 } };
