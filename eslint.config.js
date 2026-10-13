import next from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/out/**', '**/.source/**', '.tools/**', '.hig-reference/**'] },
  { plugins: { '@next/next': next }, rules: { '@next/next/no-img-element': 'warn' } },
  { files: ['packages/sfx/src/**/*.ts', 'apps/docs/components/**/*.tsx'], extends: [tseslint.configs.recommended] },
);
