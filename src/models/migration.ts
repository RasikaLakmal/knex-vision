export interface ForeignKey {
  references: string;
  inTable: string;
}

export interface ColumnChange {
  columnName: string;
  type: string;
  changeType: "add" | "drop" | "alter";
  foreignKey?: ForeignKey;
}

export interface SchemaInfo {
  tableName: string;
  changeType: "create" | "alter" | "drop" | "unknown";
  columns: ColumnChange[];
}

export interface SchemaDiff {
  tables: SchemaInfo[];
  rawSqls: string[];
  indexes?: {
    tableName?: string;
    indexName: string;
    columns: string[];
    rawSql: string;
    isUnique?: boolean;
  }[];
  materializedViews?: {
    viewName: string;
    rawSql: string;
  }[];
}

export interface Migration {
  id: string;
  name: string;
  path: string;
  timestamp: string; // YYYYMMDDHHMMSS format usually
  status: "pending" | "applied" | "unknown";
  hasUp: boolean;
  hasDown: boolean;
  diff?: SchemaDiff;
  related?: { id: string; name: string; path: string; tableNames: string[] }[];
}
