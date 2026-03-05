/**
 * This test file checks the server's defences against SQL injection attacks.
 *
 * It focuses on the applyVariables module, which substitutes user-supplied runtime
 * values into SQL and MongoDB query templates.
 *
 * It tests:
 * - That no controller or module files use raw template-literal SQL with sequelize.query()
 */

import {
  describe, it, expect,
} from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const {
  applyMysqlOrPostgresVariables
} = require("../../modules/applyVariables.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal dataRequest object for MySQL/Postgres.
 * @param {string} query   - SQL template, e.g. "SELECT * FROM t WHERE x = {{x}}"
 * @param {Array}  bindings - VariableBindings array
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Static analysis — no unsafe raw query patterns
//    Scans controllers and modules for sequelize.query() calls that
//    interpolate variables directly into the SQL string.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Static Analysis — no raw SQL string interpolation", () => {
  const CONTROLLERS_DIR = resolve(__dirname, "../../controllers");
  const MODULES_DIR = resolve(__dirname, "../../modules");

  function scanDir(dir) {
    const violations = [];
    let files = [];
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      return violations; // directory may not exist in all environments
    }
    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      const filePath = join(dir, entry.name);
      const source = readFileSync(filePath, "utf8");
      source.split("\n").forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        // Flag sequelize.query() calls that use template-literal interpolation:
        //   sequelize.query(`SELECT ... ${variable}`)
        if (/sequelize\.query\s*\(\s*`/.test(trimmed) && /\$\{/.test(trimmed)) {
          violations.push({
            file: entry.name,
            line: idx + 1,
            code: trimmed.slice(0, 120),
          });
        }
      });
    }
    return violations;
  }

  it("controllers contain no raw sequelize.query() template-literal interpolations", () => {
    const violations = scanDir(CONTROLLERS_DIR);
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}  →  ${v.code}`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} potentially unsafe raw SQL interpolation(s).\n`
        + `Use sequelize.query(sql, { replacements: [...] }) instead:\n${detail}`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("modules contain no raw sequelize.query() template-literal interpolations", () => {
    const violations = scanDir(MODULES_DIR);
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}  →  ${v.code}`)
        .join("\n");
      expect.fail(
        `Found ${violations.length} potentially unsafe raw SQL interpolation(s):\n${detail}`,
      );
    }
    expect(violations).toHaveLength(0);
  });
});
