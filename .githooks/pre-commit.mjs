import { execFileSync, spawnSync } from 'node:child_process';

const paths = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
const staged = paths(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
const unstaged = new Set(paths(['diff', '--name-only', '-z']));

if (staged.some((path) => unstaged.has(path))) {
    console.error('Prettier: stage or unstage the remaining edits in partially staged files before committing.');
    process.exit(1);
}

const result = spawnSync('pnpm', ['format'], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
if (result.status !== 0) process.exit(result.status ?? 1);

// Include formatting in this commit without staging unrelated working-tree changes.
if (staged.length > 0) execFileSync('git', ['add', '--', ...staged], { stdio: 'inherit' });
