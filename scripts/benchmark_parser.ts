import { MigrationParser } from "../src/migrations/parser";
import * as path from "path";

async function benchmark() {
  console.time("Total Time");
  const parser = new MigrationParser();
  const createPath = path.resolve(
    __dirname,
    "../examples/migrations/20240101000000_create_users.ts",
  );
  const alterPath = path.resolve(
    __dirname,
    "../examples/migrations/20240102000000_alter_users.ts",
  );

  // Simulate parsing many files
  const iterations = 50;
  console.log(`Parsing ${iterations * 2} files...`);

  const promises = [];
  for (let i = 0; i < iterations; i++) {
    promises.push(parser.parse(createPath));
    promises.push(parser.parse(alterPath));
  }

  await Promise.all(promises);
  console.timeEnd("Total Time");
}

benchmark().catch(console.error);
