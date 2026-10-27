import path from "path";
import fs from "fs";
import { describe, beforeAll, test, expect } from "vitest";
import { buildFunction, getFunctionInfo, loadSchema, loadInputQuery, loadFixture, validateTestAssets, runFunction } from "@shopify/shopify-function-test-helpers";

// Shopify Functions instruction limit.
const INSTRUCTION_LIMIT = 11_000_000;

// Real fixtures captured from function run logs go in tests/fixtures/;
// hand-built ones live in tests/fixtures/synthetic/.
function fixtureFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return fixtureFiles(full);
      return entry.name.endsWith(".json") ? [full] : [];
    });
}

describe("Fixtures (compiled wasm)", () => {
  let schema;
  let functionRunnerPath;
  let wasmPath;
  let targeting;

  beforeAll(async () => {
    const functionDir = path.dirname(__dirname);
    await buildFunction(functionDir);
    let schemaPath;
    ({ schemaPath, functionRunnerPath, wasmPath, targeting } = await getFunctionInfo(functionDir));
    schema = await loadSchema(schemaPath);
  }, 45000);

  const fixturesDir = path.join(__dirname, "fixtures");

  fixtureFiles(fixturesDir).forEach((fixtureFile) => {
    test(`runs ${path.relative(fixturesDir, fixtureFile)}`, async () => {
      const fixture = await loadFixture(fixtureFile);
      const targetInputQueryPath = targeting[fixture.target].inputQueryPath;
      const inputQueryAST = await loadInputQuery(targetInputQueryPath);

      const validationResult = await validateTestAssets({ schema, fixture, inputQueryAST });
      expect(validationResult.inputQuery.errors).toEqual([]);
      expect(validationResult.inputFixture.errors).toEqual([]);
      expect(validationResult.outputFixture.errors).toEqual([]);

      const schemaPath = path.join(path.dirname(__dirname), "schema.graphql");
      const runResult = await runFunction(fixture, functionRunnerPath, wasmPath, targetInputQueryPath, schemaPath);
      expect(runResult.error).toBeNull();
      expect(runResult.result.output).toEqual(fixture.expectedOutput);
      expect(runResult.metadata.instructionCount).toBeLessThan(INSTRUCTION_LIMIT);
      console.log(`${path.basename(fixtureFile)}: ${runResult.metadata.instructionCount} instructions`);
    }, 10000);
  });
});
