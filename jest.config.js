'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^uuid$': '<rootDir>/apps/backend/tests/mocks/uuid.js',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    '/\\.claude/',
    '/settings/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/.claude',
    '<rootDir>/settings',
  ],
};
