import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    testTimeout: 60000, // 60s timeout for tests (useful for container startup)
    hookTimeout: 120000, // 2 min for beforeAll hooks that spin up Docker containers
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "node_modules/**",
        "tests/**",
        "uploads/**",
        "models/migrations/**",
        "models/scripts/**",
        "*.config.js",
        "index.js", // Main entry point
      ],
      include: [
        "api/**",
        "controllers/**",
        "modules/**",
        "middlewares/**",
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    },
    pool: "forks", // Use forks to avoid issues with database connections
    poolOptions: {
      forks: {
        singleFork: true // Use single fork to avoid database connection conflicts
      }
    },
    globalSetup: "./tests/globalSetup.js",
    globalTeardown: "./tests/globalTeardown.js"
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
      "@tests": resolve(__dirname, "./tests"),
    },
  },
});
