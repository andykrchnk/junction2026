# Platform UI workflow

## Branches

- `master`: reviewed, integrated product.
- `feature/ui-<change>`: UI/UX work branches created directly from the latest `master`, with PRs targeting `master`.
- `feature/platform-ui` and `feature/design-system`: historical setup branches; do not use them as the base or merge target for new work.

Commit UI iterations on the current UI branch. Start the next UI branch from updated master after its predecessor is merged. Do not create task branches beneath a UI branch.

```sh
git switch master
git pull --ff-only
git switch -c feature/ui-polish
# implement, verify, commit; open PR targeting master
```

Use separate worktrees when multiple feature branches need to run simultaneously. Each worktree needs separate ports. A local server follows files in its working directory, not a branch name; switching branches in that directory changes what it serves.

## Start

```sh
pnpm install
npm --prefix design-system ci
pnpm dev:ui
```

- Platform: http://127.0.0.1:3000 (real TanStack platform, not the earlier sample dashboard).
- Storybook: http://127.0.0.1:6006.
- API: existing server at localhost:3001; authentication and live data need its environment and MongoDB configured. UI setup does not bypass authentication.

`pnpm dev:platform` and `pnpm dev:storybook` run either separately. Stop old processes on those ports before starting the combined command.

## One shared source

`design-system/src/components/ui`, `lib`, and `hooks` own approved primitives. Platform Vite and TypeScript aliases resolve to these exact files. `apps/app/src/styles.css` imports the same `design-system/src/index.css` and `tokens.css` used by Storybook. Providers match: Base UI, sharp zero-radius corners, default size, Untitled UI icons, Geist, orange primary and semantic dark/Mist colors, semibold maximum, Actions First lighting.

Edit shared source in either workflow and both running previews hot-reload. Storybook controls are temporary preview props, not a code editor: moving a slider does not rewrite production code. Persist an approved choice in the shared source or tokens.

Reuse existing shared components for UI/UX work. Compose their variants and layouts first; introduce a new component only when the existing library cannot meet a concrete requirement.

Platform pages stay in `apps/app/src/pages` and features stay in their existing slices. Effector and transport ownership do not change. Component demonstrations and sample screens are not product features.

## Experiment, approve, promote

1. Start a UI branch directly from updated master.
2. Compose experiments in `design-system/src/stories` under `Prototypes`. Scope experimental CSS to prototype classes; never import it into the platform.
3. Compare light/dark, keyboard focus, disabled/loading states and narrow screens.
4. Once selected, move the approved treatment into shared components/tokens. Current stories and platform update together.
5. Verify the platform and Storybook builds, review the diff, commit, and open the UI branch PR directly to `master`. Merge after checks and review.

Use the registry from `design-system`, not `apps/app`, to prevent a second component copy. Preserve deliberate local changes when importing updates.

The local platform URL explicitly uses IPv4 to avoid another localhost service bound only to IPv6. Configure the API APP_ORIGIN to match the platform URL when testing authentication.
