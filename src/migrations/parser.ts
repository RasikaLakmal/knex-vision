import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";
import * as path from "path";
import { Migration, SchemaDiff } from "../models/migration";

export class MigrationParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true, // Speed up parsing
      compilerOptions: {
        allowJs: true,
      },
    });
  }

  /**
   * Parses a migration file to extract metadata and validation info.
   * @param filePath Absolute path to the migration file
   */
  async parse(filePath: string): Promise<Migration> {
    const sourceFile = this.project.addSourceFileAtPath(filePath);

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
    isNullable?: boolean;
  }[] {
    if (!callbackNode) {return [];}

    const columns: {
      columnName: string;
      type: string;
      changeType: "add" | "drop" | "alter";
      foreignKey?: { references: string; inTable: string };
      isNullable?: boolean;
    }[] = [];

    // We expect an ArrowFunction or FunctionExpression
    // (table) => { ... }
    const func =
      callbackNode.asKind(SyntaxKind.ArrowFunction) ||
      callbackNode.asKind(SyntaxKind.FunctionExpression);
    if (!func) {return [];}

    const body = func.getBody();
    if (!body) {return [];}

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
      if (!exprStmt) {continue;}

      let currExpr = exprStmt.getExpression();

      let columnName: string | undefined;
      let columnType: string | undefined;
      let references: string | undefined;
      let inTable: string | undefined;
      let changeType: "add" | "drop" | "alter" = "add";
      let isNullable: boolean = true; // Default to nullable in Knex unless specified
      let isAlter = false;

      while (Node.isCallExpression(currExpr)) {
        const propAccess = currExpr
          .getExpression()
          .asKind(SyntaxKind.PropertyAccessExpression);
        if (!propAccess) {break;}

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
        } else if (methodName === "notNullable") {
          isNullable = false;
        } else if (methodName === "nullable") {
          isNullable = true;
        } else if (methodName === "primary") {
          isNullable = false;
        } else if (methodName === "alter") {
          isAlter = true;
        } else if (
          methodName === "dropColumn" ||
          methodName === "dropColumns"
        ) {
          if (args.length > 0) {
            columnName =
              this.resolveStringValue(args[0]) ||
              args[0].getText().replace(/['"`]/g, "");
            changeType = "drop";
            columnType = "unknown";
          }
          break;
        } else if (methodName === "timestamps") {
          // ... (keep existing timestamps logic)
          columns.push({
            columnName: "created_at",
            type: "timestamp",
            changeType: "add",
            isNullable: false,
          });
          columns.push({
            columnName: "updated_at",
            type: "timestamp",
            changeType: "add",
            isNullable: false,
          });
          columnName = undefined;
          break;
        } else if (methodName === "index" || methodName === "unique") {
          // Constraints
        } else {
          // Likely the column definition
          if (!columnName && args.length > 0) {
            const ignored = ["defaultTo", "unsigned", "onDelete", "onUpdate"];
            if (!ignored.includes(methodName)) {
              columnName =
                this.resolveStringValue(args[0]) ||
                args[0].getText().replace(/['"`]/g, "");
              columnType = methodName;
            }
          }
        }

        // Move down the chain
        currExpr = propAccess.getExpression();
      }

      if (columnName && columnType) {
        let finalChangeType: "add" | "drop" | "alter" = "add";
        if (changeType === "drop") {
          finalChangeType = "drop";
        } else if (parentType === "create") {
          finalChangeType = "add";
        } else {
          // alterTable context
          finalChangeType = isAlter ? "alter" : "add";
        }

        columns.push({
          columnName,
          type: columnType,
          changeType: finalChangeType,
          foreignKey:
            references && inTable ? { references, inTable } : undefined,
          isNullable,
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
      const defs = node.getDefinitionNodes();
      for (const def of defs) {
        if (Node.isVariableDeclaration(def)) {
          const initializer = def.getInitializer();
          if (initializer) {
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
