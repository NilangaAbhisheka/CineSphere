/** @type {import('jest').Config} */
module.exports = {
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@cinesphere/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  testEnvironment: 'jest-environment-jsdom',
  testRegex: '.*\\.spec\\.(ts|tsx)$',
  transform: {
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  rootDir: '.',
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
};
