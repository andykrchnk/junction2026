import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@repo/design-system/components/ui/button'
const meta = { title: 'Current/Button', component: Button, args: { children: 'Button' }, argTypes: { variant: { control: 'select', options: ['primary','secondary','tertiary','ghost','destructive'] }, size: {control:'select',options:['default','sm','lg','icon']}, disabled: {control:'boolean'} } } satisfies Meta<typeof Button>
export default meta
export const Default: StoryObj<typeof meta> = {}
export const Disabled: StoryObj<typeof meta> = { args: { disabled: true } }


import { ComponentPreview } from '@repo/design-system/stories/ComponentPreviews'
export const AllVariants = { render: () => <ComponentPreview component="Button"/> }
