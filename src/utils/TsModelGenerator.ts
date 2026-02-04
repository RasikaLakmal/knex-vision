export class TsModelGenerator {
  public static generate(migration: any): string {
    let output = "";

    // 1. Try Full Schema Snapshot (Preferred)
    if (migration.fullSchema) {
      const tables = Object.values(migration.fullSchema) as any[];

      // Filter to only include tables modified in this migration
      const affectedTableNames = new Set(
        (migration.diff?.tables || []).map((t: any) => t.tableName),
      );

      for (const table of tables) {
        if (affectedTableNames.has(table.tableName)) {
          output += this.generateModelForTable(table);
        }
      }
      return output;
    }

    // 2. Fallback to Diff (Legacy/Partial)
    if (migration.diff && migration.diff.tables) {
      for (const table of migration.diff.tables) {
        if (table.changeType === "create") {
          // Adapt simple table diff to structure expected by generateModelForTable
          const adapterTable = {
            tableName: table.tableName,
            columns: table.columns.map((c: any) => ({
              name: c.columnName,
              type: c.type,
              isNullable: c.isNullable,
              foreignKey: c.foreignKey,
            })),
          };
          output += this.generateModelForTable(adapterTable);
        }
      }
    }

    return output;
  }

  private static generateModelForTable(table: any): string {
    let output = "";
    const className = this.toPascalCase(table.tableName);
    output += `export class ${className} {\n`;

    for (const col of table.columns) {
      const fieldName = this.toCamelCase(col.name);
      const tsType = this.mapToTsType(col.type);
      const isOptional = col.isNullable ?? true;
      const modifier = isOptional ? "?" : "!";

      output += `  ${fieldName}${modifier}: ${tsType};\n`;
    }

    output += "}\n\n";
    return output;
  }

  private static toPascalCase(str: string): string {
    return str
      .replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
      .replace(/^\w/, (c) => c.toUpperCase())
      .replace(/s$/, ""); // Simple singularization for "users" -> "User"
  }

  private static toCamelCase(str: string): string {
    return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
  }

  private static mapToTsType(knexType: string): string {
    switch (knexType.toLowerCase()) {
      case "integer":
      case "biginteger":
      case "float":
      case "decimal":
      case "double":
      case "increments":
      case "bigincrements":
        return "number";
      case "string":
      case "text":
      case "uuid":
      case "binary":
        return "string";
      case "boolean":
        return "boolean";
      case "timestamp":
      case "datetime":
      case "date":
      case "time":
        return "Date";
      case "json":
      case "jsonb":
        return "any";
      default:
        return "any";
    }
  }
}
