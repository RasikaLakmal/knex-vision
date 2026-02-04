import * as vscode from "vscode";
import { KnexMigrationProvider } from "./views/treeView";
import { MigrationPreviewPanel } from "./panels/MigrationPreviewPanel";

import { MigrationParser } from "./migrations/parser";
import { MigrationService } from "./services/MigrationService";
import { SchemaReplayer } from "./services/SchemaReplayer";
import * as path from "path";

import { DbConnectionService } from "./services/DbConnectionService";

export function activate(context: vscode.ExtensionContext) {
  // Create output channel for logging
  const outputChannel = vscode.window.createOutputChannel("Knex Vision");
  outputChannel.appendLine("Knex Vision is active!");

  // Try to connect to DB on startup
  if (
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
  ) {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    DbConnectionService.setLogger(outputChannel);
    DbConnectionService.connect(root).then((connected) => {
      if (connected) {
        outputChannel.appendLine(
          "Knex Vision: Connected to database on startup.",
        );
        vscode.window.showInformationMessage(
          "Knex Vision: Connected to database.",
        );
      } else {
        outputChannel.appendLine(
          "Knex Vision: Failed to connect to database on startup.",
        );
      }
    });
  }

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
          // 1. Show panel immediately in loading state
          MigrationPreviewPanel.render(context.extensionUri);
          if (MigrationPreviewPanel.currentPanel) {
            MigrationPreviewPanel.currentPanel.setLoading(true);
          }

          try {
            // Lazy connection retry
            if (!DbConnectionService.isConnected()) {
              outputChannel.appendLine(
                "[Preview] Database not connected. Attempting lazy connection...",
              );
              if (
                vscode.workspace.workspaceFolders &&
                vscode.workspace.workspaceFolders.length > 0
              ) {
                const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
                const connected = await DbConnectionService.connect(root);
                if (connected) {
                  vscode.window.showInformationMessage(
                    "Knex Vision: Database connected.",
                  );
                } else {
                  // Log this to avoid spamming if user really has no DB
                  outputChannel.appendLine(
                    "[Preview] Lazy connection attempt failed.",
                  );
                }
              }
            }

            // Check executed migrations
            const executed = await DbConnectionService.getExecutedMigrations();

            const parser = new MigrationParser();
            const migration = await parser.parse(targetUri.fsPath);

            // Determine status
            const fileName = path.basename(targetUri.fsPath);
            const isExecuted =
              executed.has(fileName) ||
              executed.has(fileName.replace(".ts", ".js"));
            (migration as any).isExecuted = isExecuted;

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

            // Get related for UI list (excluding current)
            const related = await service.findRelatedMigrations(
              targetUri.fsPath,
              uniqueTables,
              dir,
              false,
            );

            // Get ALL related for Replay (including current)
            outputChannel.appendLine(
              "[Preview] Fetching full history for replay...",
            );
            const history = await service.findRelatedMigrations(
              targetUri.fsPath,
              uniqueTables,
              dir,
              true, // includeCurrent
            );
            outputChannel.appendLine(
              `[Preview] Found ${history.length} related migrations for replay.`,
            );

            // Filter history to only include those BEFORE or EQUAL to current timestamp
            const currentId = migration.id;

            // Use full history for identifying latest schema state
            const relevantHistory = history;

            outputChannel.appendLine(
              `[Preview] Relevant history (Full): ${relevantHistory.length} items.`,
            );

            try {
              outputChannel.appendLine("[Preview] Parsing history files...");
              // Parse all history
              const parsedHistory = await Promise.all(
                relevantHistory.map((h) => parser.parse(h.path)),
              );
              outputChannel.appendLine(
                "[Preview] Parsing complete. Replaying schema...",
              );

              // Replay
              const fullSchema = SchemaReplayer.replay(parsedHistory);
              outputChannel.appendLine(
                "[Preview] Replay complete. Full schema generated.",
              );

              (migration as any).fullSchema = fullSchema;
            } catch (replayError) {
              outputChannel.appendLine(
                `[Preview] [Error] Failed to replay full schema: ${replayError}`,
              );
              vscode.window.showWarningMessage(
                "Could not generate full history snapshot. Showing partial data.",
              );
            }

            // Attach data
            migration.related = related;

            outputChannel.appendLine(
              "[Preview] Calling MigrationPreviewPanel.render...",
            );
            MigrationPreviewPanel.render(context.extensionUri, migration);
          } catch (e: any) {
            outputChannel.appendLine(`[Preview] [Error] Render error: ${e}`);
            vscode.window.showErrorMessage(`Failed to parse migration: ${e}`);

            // Show error in panel
            if (MigrationPreviewPanel.currentPanel) {
              MigrationPreviewPanel.currentPanel.update({
                errorMessage: e.message || String(e),
              });
            }
          }
        } else {
          vscode.window.showWarningMessage("No migration file selected.");
        }
      },
    ),
  );
}

export function deactivate() {}
