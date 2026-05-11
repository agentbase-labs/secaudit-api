/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@cs-platform/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Decorator metadata + reflect-metadata are required by Nest DI in tests.
  setupFiles: ['<rootDir>/test/jest-setup.ts'],
  // Avoid open-handle warnings from Nest's transient timers under ts-jest.
  testTimeout: 20000,
};
