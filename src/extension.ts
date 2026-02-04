import * as vscode from "vscode";
import { KnexMigrationProvider } from "./views/treeView";
import { MigrationPreviewPanel } from "./panels/MigrationPreviewPanel";

import { MigrationParser } from "./migrations/parser";
import { MigrationService } from "./services/MigrationService";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  console.log("Knex Vision is active!");

  const migrationProvider = new KnexMigrationProvider();
  vscode.window.registerTreeDataProvider(
    "knex-vision-migrations",
    migrationProvider,
  );

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("knex-vision.refresh", () =>
      migrationProvider.refresh(),
    ),
  );

  // Register preview command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "knex-vision.preview",
      async (uri: vscode.Uri) => {
        let targetUri = uri;
        if (!targetUri && vscode.window.activeTextEditor) {
          targetUri = vscode.window.activeTextEditor.document.uri;
        }

        if (targetUri) {
          try {
            const parser = new MigrationParser();
            const migration = await parser.parse(targetUri.fsPath);

            // Find related migrations
            const tableNames: string[] = [];
            if (migration.diff && migration.diff.tables) {
              migration.diff.tables.forEach((t) =>
                tableNames.push(t.tableName),
              );
            }

            // dedupe
            const uniqueTables = Array.from(new Set(tableNames));

            const service = new MigrationService();
            const dir = path.dirname(targetUri.fsPath);
            const related = await service.findRelatedMigrations(
              targetUri.fsPath,
              uniqueTables,
              dir,
            );

            migration.related = related;

            MigrationPreviewPanel.render(context.extensionUri, migration);
          } catch (e) {
            vscode.window.showErrorMessage(`Failed to parse migration: ${e}`);
          }
        } else {
          vscode.window.showWarningMessage("No migration file selected.");
        }
      },
    ),
  );
}

export function deactivate() {}
