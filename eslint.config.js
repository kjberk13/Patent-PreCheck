'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      'package-lock.json',
      'handoff/**',
      'apps/website/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
  },
  {
    // backend engine code uses require()/module.exports; enforce CommonJS explicitly
    files: ['backend/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
  },
  {
    // Pre-existing engine code — relax unused-vars so imports reserved for
    // Phase 2.2+ integration (e.g., PATENTABILITY_SOURCES, fs, path) don't
    // fail lint. Scaffolding code in backend/shared/ stays strict.
    files: ['backend/patentability/**/*.js', 'backend/legal-intel/**/*.js'],
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
