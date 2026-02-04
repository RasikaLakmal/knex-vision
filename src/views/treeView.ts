import * as vscode from "vscode";
import * as path from "path";
import { Migration } from "../models/migration";
import { MigrationScanner } from "../migrations/scanner";
import { MigrationParser } from "../migrations/parser";

export class KnexMigrationProvider implements vscode.TreeDataProvider<MigrationTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    MigrationTreeItem | undefined | null | void
  > = new vscode.EventEmitter<MigrationTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    MigrationTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private scanner: MigrationScanner;
  private parser: MigrationParser;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.scanner = new MigrationScanner();
    this.parser = new MigrationParser();
    // Initialize output channel
    this.outputChannel = vscode.window.createOutputChannel("Knex Vision");
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MigrationTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MigrationTreeItem): Promise<MigrationTreeItem[]> {
    if (element) {
      return [];
    }

    const files = await this.scanner.scan();
    const items: MigrationTreeItem[] = [];

    for (const file of files) {
      try {
        const migration = await this.parser.parse(file);
        items.push(new MigrationTreeItem(migration));
      } catch (e) {
        this.outputChannel.appendLine(
          `Failed to parse migration ${file}: ${e}`,
        );
      }
    }

    return items;
  }
}

export class MigrationTreeItem extends vscode.TreeItem {
  constructor(public readonly migration: Migration) {
    super(migration.name, vscode.TreeItemCollapsibleState.None);

    this.tooltip = `${migration.timestamp} - ${migration.path}`;
    this.description = migration.timestamp;

    // Determine Icon
    if (!migration.hasDown) {
      this.iconPath = new vscode.ThemeIcon("warning");
      this.tooltip += " (Missing down method)";
    } else {
      this.iconPath = new vscode.ThemeIcon("check");
    }

    this.command = {
      command: "vscode.open",
      title: "Open Migration",
      arguments: [vscode.Uri.file(migration.path)],
    };
  }
}
