import { MigrationParser } from "../src/migrations/parser";
import { TsModelGenerator } from "../src/utils/TsModelGenerator";
import * as path from "path";

async function verify() {
  const parser = new MigrationParser();
  const filePath = path.resolve(
    __dirname,
    "../examples/migrations/20240101000000_create_users.ts",
  );

  console.log(`Parsing ${filePath}...`);
  const migration = await parser.parse(filePath);

  console.log("--- Generated TypeScript Model ---");
  const tsModel = TsModelGenerator.generate(migration);
  console.log(tsModel);
  console.log("----------------------------------");
}

verify().catch(console.error);
