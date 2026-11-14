import { fileURLToPath, URL } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'
const config: StorybookConfig = {
 stories: ['../src/**/*.stories.@(ts|tsx)', '../../../apps/app/src/stories/**/*.stories.@(ts|tsx)'],
 viteFinal: async (config) => ({ ...config, resolve: { ...config.resolve, alias: { '@': fileURLToPath(new URL('../../../apps/app/src', import.meta.url)) } } }),
 addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
 framework: '@storybook/react-vite',
}
export default config
