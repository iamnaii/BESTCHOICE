import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'off',
      'jsx-a11y/alt-text': 'error',
      'no-restricted-syntax': [
        'warn',
        {
          selector: "Literal[value=/(?:^|\\s)(?:bg|text|border|hover:bg|hover:text|hover:border|focus:bg|focus:text|focus:border|focus:ring|dark:bg|dark:text|dark:border|from|to|via)-(?:red|green|blue|yellow|amber|purple|orange|indigo|pink|rose|sky|cyan|emerald|violet|gray|slate|zinc|neutral|stone|teal|lime|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:$|\\s|\\/)/]",
          message: 'Hardcoded Tailwind color scale detected. Use semantic tokens from DESIGN.md (bg-primary, bg-success, bg-destructive, bg-warning, bg-info, bg-muted, text-foreground, etc.).',
        },
        {
          selector: "TemplateElement[value.raw=/(?:^|\\s)(?:bg|text|border|hover:bg|hover:text|hover:border|focus:bg|focus:text|focus:border|focus:ring|dark:bg|dark:text|dark:border|from|to|via)-(?:red|green|blue|yellow|amber|purple|orange|indigo|pink|rose|sky|cyan|emerald|violet|gray|slate|zinc|neutral|stone|teal|lime|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:$|\\s|\\/)/]",
          message: 'Hardcoded Tailwind color scale in template literal. Use semantic tokens from DESIGN.md.',
        },
      ],
    },
  },
  {
    // Print/receipt templates intentionally use gray/white/black Tailwind
    // scales for monochrome paper output where semantic tokens aren't
    // reliable through browser print stylesheets.
    files: [
      'src/components/payment/PrintableReceipt.tsx',
      'src/components/payment/MobileReceipt.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    ignores: ['dist/', 'playwright-report/', 'e2e/'],
  },
);
