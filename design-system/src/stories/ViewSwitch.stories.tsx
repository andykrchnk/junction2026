import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ViewSwitch } from '../components/session-dashboard/view-switch';
function Preview({ initialChecked = false, disabled = false }: { initialChecked?: boolean; disabled?: boolean }) {
    const [checked, setChecked] = useState(initialChecked);
    return <ViewSwitch label="Table view" checked={checked} onToggle={() => setChecked((value) => !value)} disabled={disabled} />;
}
const meta = { title: 'Official/View switch', component: Preview, render: (args) => <Preview key={String(args.initialChecked)} {...args} /> } satisfies Meta<
    typeof Preview
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Cards: Story = {};
export const Table: Story = { args: { initialChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
