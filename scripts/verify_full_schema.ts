import { MigrationParser } from "../src/migrations/parser";
import { SchemaReplayer } from "../src/services/SchemaReplayer";
import { TsModelGenerator } from "../src/utils/TsModelGenerator";
import * as path from "path";

async function verify() {
  const parser = new MigrationParser();
  const createPath = path.resolve(
    __dirname,
    "../examples/migrations/20240101000000_create_users.ts",
  );
  const alterPath = path.resolve(
    __dirname,
    "../examples/migrations/20240102000000_alter_users.ts",
  );

  console.log(`Parsing migrations...`);
  const createMigration = await parser.parse(createPath);
  const alterMigration = await parser.parse(alterPath);

  const allMigrations = [createMigration, alterMigration];

  console.log("--- Alter Migration Parsed Data ---");
  console.log(JSON.stringify(alterMigration.diff?.tables, null, 2));

  console.log("--- Replaying Schema ---");
  const fullSchema = SchemaReplayer.replay(allMigrations);
  console.log(JSON.stringify(fullSchema, null, 2));

  console.log("--- Generated TypeScript Model (Full) ---");
  // Mocking the structure attached in extension.ts
  const migrationContext = { ...alterMigration, fullSchema };
  const tsModel = TsModelGenerator.generate(migrationContext);
  console.log(tsModel);
  console.log("----------------------------------");
}

verify().catch(console.error);
