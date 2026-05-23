'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/mocks/uuid.js',
  },
  testMatch: [
    '**/tests/**/*.test.js',
    '**/*.test.js',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/node_modules',
  ],
  collectCoverageFrom: [
    'bot/**/*.js',
    '!bot/**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches:   50,
      functions:  50,
      lines:      50,
      statements: 50,
    },
  },
  verbose:     true,
  clearMocks:  true,
  testTimeout: 10000,
};
