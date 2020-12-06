// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

module.exports = {
  globals: {
    "ts-jest": {
      tsconfig: "./tsconfig.jest.json",
      babelConfig: true,
      diagnostics: true,
    },
  },
  transform: {
    "^.+\\.tsx?$": "./node_modules/ts-jest",
  },
  testEnvironment: "node",
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  moduleNameMapper: {
    "^ts-jest$": "<rootDir>/node_modules/ts-jest",
    "^@microsoft/signalr$": "<rootDir>/dist/index.js",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
};
