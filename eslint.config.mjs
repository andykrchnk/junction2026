import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/node_modules/**', '**/dist/**', '**/.output/**', '**/.tanstack/**', '**/routeTree.gen.ts', 'research/**'] },
    ...tseslint.configs.recommended,
    { rules: { '@typescript-eslint/consistent-type-imports': 'error', '@typescript-eslint/no-explicit-any': 'error' } },
);
