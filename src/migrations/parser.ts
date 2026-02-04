import {
  Project,
  SourceFile,
  SyntaxKind,
  Node,
  StringLiteral,
  TemplateExpression,
  NoSubstitutionTemplateLiteral,
  Identifier,
} from "ts-morph";
import * as path from "path";
import { Migration, SchemaDiff } from "../models/migration";

export class MigrationParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Parses a migration file to extract metadata and validation info.
   * @param filePath Absolute path to the migration file
   */
  async parse(filePath: string): Promise<Migration> {
    let sourceFile: SourceFile | undefined =
      this.project.getSourceFile(filePath);
    if (sourceFile) {
      await sourceFile.refreshFromFileSystem();
    } else {
      sourceFile = this.project.addSourceFileAtPath(filePath);
    }

    // Refresh from disk to be sure (if cached)
    await sourceFile.refreshFromFileSystem();

    const fileName = path.basename(filePath);
    // Assuming format: YYYYMMDDHHMMSS_name.ts
    const parts = fileName.split("_");
    const timestamp = parts[0];
    const name = parts
      .slice(1)
      .join("_")
      .replace(/\.(ts|js)$/, "");

    const upNode = this.getExportedFunctionNode(sourceFile, "up");
    const downNode = this.getExportedFunctionNode(sourceFile, "down");
    const hasUp = !!upNode;
    const hasDown = !!downNode;

    const diff = await this.extractSchemaDiff(upNode);

    return {
      id: timestamp, // Using timestamp as ID for now
      name,
      path: filePath,
      timestamp,
      status: "unknown", // Need DB separate check for this
      hasUp,
      hasDown,
      diff,
    };
  }

  private async extractSchemaDiff(
    upNode: Node | undefined,
  ): Promise<SchemaDiff | undefined> {
    if (!upNode) {
      return undefined;
    }

    const tables: {
      tableName: string;
      changeType: "create" | "alter" | "drop" | "unknown";
      columns: {
        columnName: string;
        type: string;
        changeType: "add" | "drop" | "alter";
      }[];
    }[] = [];
    const rawSqls: string[] = [];
    const indexes: {
      tableName?: string;
      indexName: string;
      columns: string[];
      rawSql: string;
      isUnique?: boolean;
    }[] = [];
    const materializedViews: {
      viewName: string;
      rawSql: string;
    }[] = [];

    // Naively look for processing calls
    // knex.schema.createTable('users', (table) => { ... })
    const callExpressions = upNode.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    );
    for (const call of callExpressions) {
      const expression = call.getExpression();
      const text = expression.getText(); // e.g. "knex.schema.createTable" OR "schema.createTable"

      if (text.endsWith("createTable")) {
        const args = call.getArguments();
        if (args.length > 0) {
          const tableName =
            this.resolveStringValue(args[0]) ||
            args[0].getText().replace(/['"`]/g, "");
          const columns = this.extractColumnsFromCallback(args[1], "create");
          tables.push({ tableName, changeType: "create", columns });
        }
      } else if (text.endsWith("alterTable")) {
        const args = call.getArguments();
        if (args.length > 0) {
          const tableName =
            this.resolveStringValue(args[0]) ||
            args[0].getText().replace(/['"`]/g, "");
          const columns = this.extractColumnsFromCallback(args[1], "alter");
          tables.push({ tableName, changeType: "alter", columns });
        }
      } else if (
        text.endsWith("dropTable") ||
        text.endsWith("dropTableIfExists")
      ) {
        const args = call.getArguments();
        if (args.length > 0) {
          const tableName =
            this.resolveStringValue(args[0]) ||
            args[0].getText().replace(/['"`]/g, "");
          tables.push({ tableName, changeType: "drop", columns: [] });
        }
      } else if (text.endsWith(".raw")) {
        // knex.raw('SQL')
        const args = call.getArguments();
        if (args.length > 0) {
          const rawContent = this.resolveTemplateString(args[0]);
          if (rawContent) {
            rawSqls.push(rawContent);

            // Attempt to parse CREATE INDEX (and UNIQUE)
            // CREATE [UNIQUE] INDEX [IF NOT EXISTS] index_name ON table_name (col1, col2) ...
            const indexMatch = rawContent.match(
              /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/i,
            );
            if (indexMatch) {
              indexes.push({
                indexName: indexMatch[2],
                tableName: indexMatch[3],
                columns: indexMatch[4].split(",").map((s) => s.trim()),
                rawSql: rawContent,
                isUnique: !!indexMatch[1],
              });
            }

            // Attempt to parse CREATE MATERIALIZED VIEW
            // CREATE MATERIALIZED VIEW view_name AS ...
            const viewMatch = rawContent.match(
              /CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+AS/i,
            );
            if (viewMatch) {
              materializedViews.push({
                viewName: viewMatch[1],
                rawSql: rawContent,
              });
            }
          }
        }
      }
    }

    return { tables, rawSqls, indexes, materializedViews };
  }

  private extractColumnsFromCallback(
    callbackNode: Node | undefined,
    parentType: "create" | "alter",
  ): {
    columnName: string;
    type: string;
    changeType: "add" | "drop" | "alter";
    foreignKey?: { references: string; inTable: string };
  }[] {
    if (!callbackNode) return [];

    const columns: {
      columnName: string;
      type: string;
      changeType: "add" | "drop" | "alter";
      foreignKey?: { references: string; inTable: string };
    }[] = [];

    // We expect an ArrowFunction or FunctionExpression
    // (table) => { ... }
    const func =
      callbackNode.asKind(SyntaxKind.ArrowFunction) ||
      callbackNode.asKind(SyntaxKind.FunctionExpression);
    if (!func) return [];

    const body = func.getBody();
    if (!body) return [];

    // Iterate over statements to handle delegation/chaining
    // table.uuid('user_id').references('id').inTable('users');
    let statements: Node[] = [];
    if (Node.isBlock(body)) {
      statements = body.getStatements();
    } else {
      // If it's a concise arrow function `t => t.string('x')` (implicit return), treat the expression as a statement?
      // But Knex migrations usually use a block. For now support block.
      // If body is an expression, wrap it?
      // body.getKindName() might be CallExpression
      statements = [body];
    }

    for (const statement of statements) {
      // We look for ExpressionStatements that are CallExpressions or chains of them
      const exprStmt = statement.asKind(SyntaxKind.ExpressionStatement);
      if (!exprStmt) continue;

      let currExpr = exprStmt.getExpression();

      // Unwrap chains: .inTable().references().uuid()
      // The AST structure for `a.b().c()` is Call(Expression: PropAccess(Expression: Call(Expression: PropAccess(Expression: a, Name: b)), Name: c))
      // So the "outermost" text is the last function called.

      let columnName: string | undefined;
      let columnType: string | undefined;
      let references: string | undefined;
      let inTable: string | undefined;
      let changeType: "add" | "drop" | "alter" = "add"; // default

      // We traverse down the chain
      while (Node.isCallExpression(currExpr)) {
        const propAccess = currExpr
          .getExpression()
          .asKind(SyntaxKind.PropertyAccessExpression);
        if (!propAccess) break;

        const methodName = propAccess.getName();
        const args = currExpr.getArguments();

        if (methodName === "references" && args.length > 0) {
          references =
            this.resolveStringValue(args[0]) ||
            args[0].getText().replace(/['"`]/g, "");
        } else if (methodName === "inTable" && args.length > 0) {
          inTable =
            this.resolveStringValue(args[0]) ||
            args[0].getText().replace(/['"`]/g, "");
        } else if (
          methodName === "dropColumn" ||
          methodName === "dropColumns"
        ) {
          changeType = "drop";
          // For dropColumn, args are the names
          args.forEach((arg) => {
            const name =
              this.resolveStringValue(arg) ||
              arg.getText().replace(/['"`]/g, "");
            columns.push({
              columnName: name,
              type: "unknown",
              changeType: "drop",
            });
          });
          // We handled this statement, break loop (assuming dropColumn doesn't chain meaningful adds)
          columnName = undefined;
          break;
        } else if (methodName === "timestamps") {
          columns.push({
            columnName: "created_at",
            type: "timestamp",
            changeType: "add",
          });
          columns.push({
            columnName: "updated_at",
            type: "timestamp",
            changeType: "add",
          });
          columnName = undefined;
          break;
        } else if (
          methodName === "primary" ||
          methodName === "index" ||
          methodName === "unique"
        ) {
          // Constraints, skip for now or attach?
          // Often table.primary([...]) - not a column def
        } else {
          // Likely the column definition: table.string('name')
          // It's usually the "base" of the chain, but we are traversing backwards from end of chain.
          // So we keep going until we find the one called on 'table' (identifier)?
          // Or we check if arg[0] is string.

          // If we find a method that looks like a type def and has a string arg, assume it is the column.
          if (!columnName && args.length > 0) {
            // Check if it's the `table` object?
            // propAccess.getExpression() is the object.
            // If we are at `table.string('x')`, object is `table` (Identifier).
            // If we are at `table.string('x').notNullable()`, object is `table.string('x')` (CallExpression).

            // We prefer the 'deepest' one that has a string arg, which is likely the type def.
            // But wait, `references('id')` also has string arg.
            // We filtered ref/inTable.

            // Heuristic: If we haven't found a column name yet, and this isn't a known modifier (notNullable, defaultTo),
            // and references/inTable are already handled or this isn't them.

            const ignored = [
              "notNullable",
              "nullable",
              "defaultTo",
              "unsigned",
              "index",
              "unique",
              "primary",
              "onDelete",
              "onUpdate",
            ];
            if (!ignored.includes(methodName)) {
              columnName =
                this.resolveStringValue(args[0]) ||
                args[0].getText().replace(/['"`]/g, "");
              columnType = methodName;

              if (
                parentType === "alter" &&
                (methodName === "alter" || args.length === 0)
              ) {
                // Handle .alter()
                // If explicit .alter() call exists in chain?
                // Logic: in "alter" parentType, default is "add" unless we see known modification pattern?
                // Knex: `table.string('x').alter()`
              }
            }
          }
        }

        // Move down the chain
        currExpr = propAccess.getExpression();
      }

      // Check if we hit the `table` identifier at the bottom
      // if (Node.isIdentifier(currExpr) && currExpr.getText() === 'table') { ... }

      if (columnName && columnType) {
        columns.push({
          columnName,
          type: columnType,
          changeType: parentType === "create" ? "add" : "alter",
          foreignKey:
            references && inTable ? { references, inTable } : undefined,
        });
      }
    }

    return columns;
  }

  private getExportedFunctionNode(
    sourceFile: SourceFile,
    functionName: string,
  ): Node | undefined {
    const parsedFunc = sourceFile.getFunction(functionName);
    if (parsedFunc && parsedFunc.isExported()) {
      return parsedFunc;
    }

    // Also check for export const/let/var
    const variable = sourceFile.getVariableDeclaration(functionName);
    if (variable) {
      const varStatement = variable.getVariableStatement();
      if (varStatement && varStatement.isExported()) {
        // Return the initializer if it's a function/arrow function
        return variable.getInitializer();
      }
    }

    // Check for exports.up = ... or module.exports.up = ... (CommonJS style)
    const statements = sourceFile.getStatements();
    for (const statement of statements) {
      if (statement.getKind() === SyntaxKind.ExpressionStatement) {
        const expression = statement
          .asKind(SyntaxKind.ExpressionStatement)
          ?.getExpression();
        if (expression?.getKind() === SyntaxKind.BinaryExpression) {
          const binaryExpression = expression.asKind(
            SyntaxKind.BinaryExpression,
          );
          const left = binaryExpression?.getLeft();
          const text = left?.getText().replace(/\s/g, "");

          // Matches: exports.up, module.exports.up
          if (
            text === `exports.${functionName}` ||
            text === `module.exports.${functionName}`
          ) {
            return binaryExpression?.getRight();
          }
        }
      }
    }

    return undefined;
  }

  private resolveStringValue(node: Node): string | undefined {
    if (
      Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node)
    ) {
      return node.getLiteralText();
    }

    if (Node.isIdentifier(node)) {
      const definitions = node.getDefinitions();
      // We can't easily jump to definition and get the node without referencing the AST.
      // Better: use getDefinitionNodes() if available, or finding references.
      // A safer, simpler strategy given we have the source file:
      const defs = node.getDefinitionNodes();
      for (const def of defs) {
        if (Node.isVariableDeclaration(def)) {
          const initializer = def.getInitializer();
          if (initializer) {
            // Recursively resolve? For now, just 1 level deep.
            if (
              Node.isStringLiteral(initializer) ||
              Node.isNoSubstitutionTemplateLiteral(initializer)
            ) {
              return initializer.getLiteralText();
            }
          }
        }
      }
    }

    return undefined;
  }

  private resolveTemplateString(node: Node): string | undefined {
    if (
      Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node)
    ) {
      return node.getLiteralText();
    }

    if (Node.isTemplateExpression(node)) {
      const templateExpr = node.asKind(SyntaxKind.TemplateExpression);
      let result = templateExpr?.getHead().getLiteralText() || "";

      const spans = templateExpr?.getTemplateSpans() || [];
      for (const span of spans) {
        const expr = span.getExpression();
        const val =
          this.resolveStringValue(expr) || "${" + expr.getText() + "}";
        result += val;
        result += span.getLiteral().getLiteralText();
      }
      return result;
    }

    return undefined;
  }
}
