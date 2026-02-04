import * as vscode from "vscode";
import * as path from "path";

export class MigrationScanner {
  /**
   * Scans the workspace for migration files.
   * Assumes a standard knex migration folder structure (migrations/*.ts or migrations/*.js)
   * @returns List of file paths sorted by filename (which usually starts with timestamp)
   */
  async scan(): Promise<string[]> {
    // Find files in migrations folder
    // We look for .ts and .js files in a 'migrations' folder anywhere in the workspace
    const files = await vscode.workspace.findFiles(
      "**/migrations/*.{ts,js}",
      "**/{node_modules,dist,out,build}/**",
    );

    // Convert to absolute paths, filter definition files, and sort
    const filePaths = files
      .map((uri) => uri.fsPath)
      .filter((p) => !p.endsWith(".d.ts"))
      .sort((a, b) => {
        const nameA = path.basename(a);
        const nameB = path.basename(b);
        return nameA.localeCompare(nameB);
      });

    return filePaths;
  }
}
