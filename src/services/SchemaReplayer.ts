import { Migration, SchemaDiff, ColumnChange } from "../models/migration";

export interface ColumnSnapshot {
  name: string;
  type: string;
  isNullable: boolean;
  foreignKey?: { references: string; inTable: string };
}

export interface TableSnapshot {
  tableName: string;
  columns: ColumnSnapshot[];
}

export class SchemaReplayer {
  public static replay(migrations: Migration[]): Record<string, TableSnapshot> {
    const tables: Record<string, TableSnapshot> = {};

    // Sort by timestamp is critical, but we assume the input is already sorted or we sort here.
    // Migration IDs are timestamps.
    const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));

    for (const migration of sorted) {
      if (!migration.diff || !migration.diff.tables) {continue;}

      for (const change of migration.diff.tables) {
        if (!tables[change.tableName]) {
          tables[change.tableName] = {
            tableName: change.tableName,
            columns: [],
          };
        }

        const currentColumns = tables[change.tableName].columns;

        if (change.changeType === "create") {
          // Add all columns
          for (const col of change.columns) {
            currentColumns.push({
              name: col.columnName,
              type: col.type,
              isNullable: col.isNullable ?? true, // Default nullable if unknown
              foreignKey: col.foreignKey,
            });
          }
        } else if (change.changeType === "alter") {
          // Apply changes
          for (const col of change.columns) {
            if (col.changeType === "add") {
              currentColumns.push({
                name: col.columnName,
                type: col.type,
                isNullable: col.isNullable ?? true,
                foreignKey: col.foreignKey,
              });
            } else if (col.changeType === "drop") {
              // Remove column
              const idx = currentColumns.findIndex(
                (c) => c.name === col.columnName,
              );
              if (idx !== -1) {
                currentColumns.splice(idx, 1);
              }
            } else if (col.changeType === "alter") {
              // Update column details
              const existing = currentColumns.find(
                (c) => c.name === col.columnName,
              );
              if (existing) {
                existing.type = col.type;
                if (col.isNullable !== undefined) {
                  existing.isNullable = col.isNullable;
                }
                if (col.foreignKey) {
                  existing.foreignKey = col.foreignKey;
                }
              }
            }
          }
        } else if (change.changeType === "drop") {
          delete tables[change.tableName];
        }
      }
    }

    return tables;
  }
}
