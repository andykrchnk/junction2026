# Design system workshop

React + Vite + Storybook with 29 official shadcn components and locally bundled Geist Variable. Components retain neutral shadcn defaults; brand styling is intentionally pending.

## Preview

Use Node 24+: run `npm ci`, then `npm run storybook` in this directory. Open http://localhost:6006. The toolbar switches light/dark previews; the accessibility panel supports manual audits.

## Editing and handoff

- `src/index.css`: semantic colors in both themes and radius mappings.
- `src/tokens.css`: typography roles (caption through display), spacing roles (inline through page), motion durations and reduced-motion support.
- `src/components/ui`: editable component source imported from shadcn.
- `src/stories`: foundation previews and representative component interactions, plus Button controls.

Tokens are provisional. Component-specific defaults have not yet all been migrated to semantic spacing and motion. Add dedicated stories for the remaining imported components as their design is explored. Check focus, disabled/invalid states, narrow layouts, themes, and reduced motion before approving a component.

Run `npm run build`, `npm run lint`, and `npm run build-storybook` for verification. Publish the generated `storybook-static` folder on static hosting for developer handoff.

## Fluid Functionalism baseline

The primary library is now Fluid Functionalism: all 34 documented components are imported through its official shadcn registry, with surfaces, typography, interaction tokens, spring presets and FluidProvider. Inter Variable replaces Geist per Fluid's setup requirements. Provider defaults remain rounded, default size, and Lucide icons, using the Radix registry flavor where available.

Open **Fluid / All components** for the entire gallery. The workshop toolbar edits `--fluid-accent`, persists it in this browser, resets it, and exports CSS. Neutral primary button fills intentionally follow Fluid's foreground token, rather than the accent. The light/dark toolbar applies to portalled popups as well.

Vite compatibility change: the imported Card's Next.js Link was replaced with a native anchor. The remaining shadcn AlertDialog uses Fluid's primary/tertiary button variant names. Other library implementations retain upstream behavior.

Source: https://www.fluidfunctionalism.com/docs

## Sharp green preset

The official `setup/sharp-green.json` preset now replaces the previous Radix baseline: Base UI, sharp shape, default size, Untitled UI icons, system theme, and green accent (`light-dark(#00A63E, #05DF72)`). `FluidRoot` supplies the shared settings. Press D outside text fields to toggle themes. Storybook also offers system/light/dark in its toolbar.

Inter loads the optical-size variable font via `@fontsource-variable/inter/opsz.css`. Geist Serif Regular is bundled locally from the installed geist package for h1–h3, with the requested 32/38 display and 28/34 compact display scale. This workspace uses Vite, so the Next-specific font loader is replaced by equivalent local font CSS, and Card uses native anchors.

Run `npm run dev` for the standalone gallery or `npm run storybook` for the design workshop. The registry alias is configured for future `npx shadcn@latest add @fluid/base/<name>` imports.

## Current font decision

Geist Sans Variable is used throughout body text, components, and headings, replacing Inter and Geist Serif at the user’s request. The serif-only display-size increase and forced 400 heading weight are removed; Fluid’s original type scale and component weights apply.

## Global emphasis policy

Semibold (600) is the strongest text weight. Bold is a compatibility alias for semibold in the shared animated weight tokens, Tailwind utilities, and rich text. Apply typography decisions globally through `src/tokens.css`, `src/lib/font-weight.ts`, and the theme mappings in `src/index.css`, rather than changing individual previews.

## Global corner policy

Sharp means zero radius throughout the design system, including controls, surfaces, focus rings, indicators, portal content, and animated corners. The shared sharp shape map uses zero numeric radii, and the global CSS policy overrides remaining fixed or inline radii. Preserve this intentional departure from Fluid's default 1px sharp radius when updating registry components.

## Current color palette

Colors come from https://dotui.org/studio?s=2r5octjQnZ (green #006100, Mist neutrals). Exact light/dark tokens are mapped at the end of `src/index.css`; Fluid surface levels use sidebar/card/popover colors. Primary buttons use primary, primary-hover, primary-active and primary-foreground. No DotUI component code, sizing, motion, or typography was imported.

Spacing uses exact pixels globally: inline 8, control 12, group 16, stack 24, section 32, page 64. Tailwind spacing utilities use a 4px base instead of a rem-based unit. Preview labels report actual measurements without rounding.

## Current and prototype environments

`Current / All components` and `Current / Button` are the official project baseline. `Prototypes / Button` retains the button experiments; `Prototypes / Component balance` compares the selected Quiet Edge direction across controls and panels. Quiet Edge (iteration 1) is the user's chosen button direction, pending approval of the supporting component balance before global rollout. Prototype CSS is scoped and must not affect Current.

## Approved lighting: Actions First

Actions First is now the official shared Button treatment: primary and destructive use Quiet Edge (25% top highlight, 4% sheen, 4% bottom shade); secondary reduces the top edge to 10%; tertiary and ghost remain flat. Supporting surfaces stay flat. Applies throughout Current and the app, including composed button links. Prototype classes keep their isolated lighting.

## Individual component previews

All 34 documented Fluid components have their own group under Current. Each Default story renders the same stateful example as All components through `src/stories/ComponentPreviews.tsx`, keeping the isolated preview and gallery consistent. Button also includes adjustable controls, Disabled, and All Variants. Prototypes remain separate from these official examples.
