import * as fs from "fs";
import * as path from "path";

export class MigrationService {
  constructor() {}

  async findRelatedMigrations(
    currentFilePath: string,
    tableNames: string[],
    migrationsDir: string,
  ): Promise<
    { id: string; name: string; path: string; tableNames: string[] }[]
  > {
    if (tableNames.length === 0) return [];

    const related: {
      id: string;
      name: string;
      path: string;
      tableNames: string[];
    }[] = [];

    // Get all files in directory
    try {
      const files = await fs.promises.readdir(migrationsDir);

      // Filter out current file and non-ts/js
      const candidates = files.filter((f) => {
        const fullPath = path.join(migrationsDir, f);
        return (
          fullPath !== currentFilePath &&
          (f.endsWith(".ts") || f.endsWith(".js"))
        );
      });

      // Fast text search
      for (const file of candidates) {
        const fullPath = path.join(migrationsDir, file);
        const content = await fs.promises.readFile(fullPath, "utf-8");

        // Check if any of the table names appear in the content
        const matches = tableNames.filter((t) => content.includes(t));
        if (matches.length > 0) {
          const fileName = path.basename(file);
          const parts = fileName.split("_");
          const timestamp = parts[0];
          const name = parts
            .slice(1)
            .join("_")
            .replace(/\.(ts|js)$/, "");

          related.push({
            id: timestamp,
            name,
            path: fullPath,
            tableNames: matches,
          });
        }
      }
    } catch (e) {
      console.error("Error scanning migrations:", e);
    }

    return related.sort((a, b) => a.id.localeCompare(b.id)); // Sort by time
  }
}
