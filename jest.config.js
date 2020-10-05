/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/tests"],
    transform: {
        "^.+\\.tsx?$": "ts-jest",
    },
    testRegex: "(.*(test|spec)).(jsx|js|tsx|ts)",
    moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
    collectCoverageFrom: ["<rootDir>/src/**/*.{ts,tsx}", "!**/node_modules/**", "!**/vendor/**"],
};
