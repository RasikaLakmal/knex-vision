import { Migration } from "../models/migration";

export class MigrationAnalyzer {
  /**
   * returns a list of warnings or errors
   */
  analyze(migration: Migration): string[] {
    const issues: string[] = [];

    if (!migration.hasUp) {
      issues.push('Missing "up" function');
    }

    if (!migration.hasDown) {
      issues.push('Missing "down" function');
    }

    return issues;
  }
}
