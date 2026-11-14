# Contributing

Create `feature/<description>` branches from the latest `master`; open PRs to `master`, the existing default branch. Keep feature branches current by rebasing, and do not push directly to `master`. Do not introduce LEAF's develop/main branches into this repository.

Commit after each requested implementation step with Conventional Commits: `<type>(optional scope): <present-tense description>`, lowercase type and no trailing period. Review the complete diff, run relevant checks, and report limits in the PR. Never commit credentials, environment files, dependency directories or private datasets. Merge through review; do not merge the PR automatically.

`pnpm install` enables the shared pre-commit hook. It runs `pnpm format` across the project and restages only files already staged for the commit. Other formatting changes remain unstaged. Partially staged files must be fully staged or unstaged before committing.

## Platform UI work

Create each `feature/ui-<change>` branch directly from the latest `master` and open its PR directly to `master`. Do not create child branches from an ongoing UI branch or use `feature/platform-ui` as an integration target. Reuse the existing shared design-system components; extend or compose them before introducing a new primitive. See [the UI workflow](docs/ui-workflow.md).
