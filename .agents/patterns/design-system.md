# Design and shadcn components

## Rules

Use [Fluid Functionalism](https://www.fluidfunctionalism.com/docs) first when adding or updating UI components. Fall back to basic shadcn/ui when Fluid has no suitable component or cannot meet a concrete accessibility or interaction requirement. Record a non-obvious fallback reason near the component or in the change description.

The `@fluid` registry is configured in `packages/design-system/components.json`. Preserve the existing Base UI primitives. Install only the components needed for the task:

```sh
pnpm dlx shadcn@latest add @fluid/<component> --cwd packages/design-system
```

Review generated changes before accepting overwrites, dependencies and theme tokens. Keep components in `packages/design-system/src/components/ui`, import through @repo/design-system exports and adapt source to strict TypeScript and repository conventions. Preserve application colors, fonts, focus visibility, keyboard behavior, native form attributes and reduced-motion preferences. Reuse the supplied interaction and size tokens rather than inventing competing scales.

Use the component's own loading and icon APIs where available. Effector continues to own business pending/error state; UI primitives only render that state. Do not install the full component library or add showcase pages, demos or tests unless requested.

## Examples

- [Button](../../../packages/design-system/src/components/ui/button.tsx)
- [Input](../../../packages/design-system/src/components/ui/input.tsx)
- [Authentication form](../../../apps/app/src/features/authentication/auth-form.tsx)

## Review

Check Fluid-first selection, a suitable shadcn fallback, theme compatibility, accessibility and component state ownership.
