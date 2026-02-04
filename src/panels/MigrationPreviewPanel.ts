import * as vscode from "vscode";

export class MigrationPreviewPanel {
  public static currentPanel: MigrationPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      extensionUri,
    );
  }

  public static render(extensionUri: vscode.Uri, migration?: any) {
    if (MigrationPreviewPanel.currentPanel) {
      MigrationPreviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
    } else {
      const panel = vscode.window.createWebviewPanel(
        "knexVisionPreview",
        "Migration Preview",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
        },
      );

      MigrationPreviewPanel.currentPanel = new MigrationPreviewPanel(
        panel,
        extensionUri,
      );
    }

    if (migration) {
      MigrationPreviewPanel.currentPanel.update(migration);
    }
  }

  public update(migration: any) {
    this._panel.webview.postMessage({ command: "update", migration });
  }

  public dispose() {
    MigrationPreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
  ) {
    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Migration Preview</title>
        <style>
          body { font-family: sans-serif; padding: 20px; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
          .timeline { border-left: 2px solid var(--vscode-button-background); padding-left: 20px; margin-bottom: 20px; }
          .migration-header { font-size: 1.2em; font-weight: bold; margin-bottom: 10px; }
          .diff-container { background-color: var(--vscode-editor-inactiveSelectionBackground); padding: 10px; border-radius: 5px; }
          .table-change { margin-bottom: 15px; }
          .table-name { font-weight: bold; color: var(--vscode-textLink-foreground); }
          .column-change { margin-left: 20px; font-family: monospace; }
          .badge { padding: 2px 5px; border-radius: 3px; font-size: 0.8em; margin-right: 5px; }
          .badge-create { background-color: #28a745; color: white; }
          .badge-alter { background-color: #ffc107; color: black; }
          .badge-drop { background-color: #dc3545; color: white; }
          .badge-add { background-color: #28a745; color: white; }
        </style>
      </head>
      <body>
        <div id="app">
            <h1>Waiting for data...</h1>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'update':
                        renderMigration(message.migration);
                        break;
                }
            });

            function renderMigration(migration) {
                const app = document.getElementById('app');
                if (!migration) {
                    app.innerHTML = '<h1>No migration data</h1>';
                    return;
                }

                let html = \`
                    <div class="migration-header">\${migration.name} (\${migration.id})</div>
                    <div class="timeline">
                        <div>Functions: Up \${migration.hasUp ? '✅' : '❌'}, Down \${migration.hasDown ? '✅' : '❌'}</div>
                    </div>
                    <h2>Schema Changes</h2>
                \`;

                if (migration.diff && (migration.diff.tables || migration.diff.rawSqls)) {
                    html += '<div class="diff-container">';
                    
                    if (migration.diff.tables) {
                        migration.diff.tables.forEach(table => {
                            let badgeClass = 'badge-' + table.changeType;
                            html += \`
                                <div class="table-change">
                                    <span class="badge \${badgeClass}">\${table.changeType.toUpperCase()} TABLE</span>
                                    <span class="table-name">\${table.tableName}</span>
                            \`;
                            
                            if (table.columns && table.columns.length > 0) {
                                html += '<div>';
                                   table.columns.forEach(col => {
                                    const colBadge = 'badge-' + col.changeType;
                                    let extra = '';
                                    if (col.foreignKey) {
                                        extra = \` <span style="color: var(--vscode-textLink-activeForeground);">→ \${col.foreignKey.inTable}.\${col.foreignKey.references}</span>\`;
                                    }
                                    html += \`<div class="column-change">
                                        <span class="badge \${colBadge}">\${col.changeType.toUpperCase()}</span>
                                        \${col.columnName} <span style="opacity: 0.7">(\${col.type})</span>\${extra}
                                    </div>\`;
                                });   
                                html += '</div>';
                            }
                            
                            html += '</div>';
                        });
                    }

                    if (migration.diff.rawSqls && migration.diff.rawSqls.length > 0) {
                        html += '<div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc;">';
                        html += '<h3>Raw SQL</h3>';
                        migration.diff.rawSqls.forEach(sql => {
                             html += \`<pre style="background: rgba(0,0,0,0.1); padding: 5px; border-radius: 3px; overflow-x: auto;">\${sql}</pre>\`;
                        });
                        html += '</div>';
                    }

                    if (migration.diff.indexes && migration.diff.indexes.length > 0) {
                        html += '<div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc;">';
                        html += '<h3>Indexes</h3>';
                        migration.diff.indexes.forEach(idx => {
                             const badge = idx.isUnique ? '<span class="badge badge-alter">UNIQUE</span>' : '<span class="badge badge-add">INDEX</span>';
                             html += \`
                                <div class="index-item" style="margin-bottom: 8px; padding: 5px; background: rgba(0,0,255,0.05); border-radius: 3px;">
                                    \${badge}
                                    <span style="font-weight: bold;">\${idx.indexName}</span>
                                    <span style="opacity: 0.8;">ON \${idx.tableName}</span>
                                    <div style="margin-left: 20px; font-size: 0.9em; opacity: 0.8;">
                                        Columns: \${idx.columns.join(', ')}
                                    </div>
                                </div>
                             \`;
                        });
                        html += '</div>';
                    }

                    if (migration.diff.materializedViews && migration.diff.materializedViews.length > 0) {
                        html += '<div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #ccc;">';
                        html += '<h3>Materialized Views</h3>';
                        migration.diff.materializedViews.forEach(view => {
                             html += \`
                                <div class="view-item" style="margin-bottom: 8px; padding: 5px; background: rgba(255,165,0,0.1); border-radius: 3px;">
                                    <span class="badge badge-add" style="background-color: #dcb20a; color: black;">VIEW</span>
                                    <span style="font-weight: bold;">\${view.viewName}</span>
                                    <pre style="margin-top: 5px; padding: 5px; background: rgba(0,0,0,0.1); border-radius: 3px; font-size: 0.8em; overflow-x: auto;">\${view.rawSql}</pre>
                                </div>
                             \`;
                        });
                        html += '</div>';
                    }

                    html += '</div>';
                } else {
                    html += '<p>No schema changes detected (or parsing failed).</p>';
                }

                if (migration.related && migration.related.length > 0) {
                    html += \`
                        <div class="related-migrations" style="margin-top: 30px; border-top: 1px solid var(--vscode-widget-border);">
                            <h2>Related Migrations</h2>
                            <p style="opacity: 0.8; font-size: 0.9em;">Other files referencing \${migration.diff?.tables.map(t => t.tableName).join(', ')}</p>
                            <ul style="list-style: none; padding: 0;">
                    \`;
                    
                    migration.related.forEach(rel => {
                        html += \`
                            <li style="margin-bottom: 8px;">
                                <span style="font-family: monospace; background: var(--vscode-textBlockQuote-background); padding: 2px 4px; border-radius: 3px;">\${rel.id}</span>
                                <span style="font-weight: 500;">\${rel.name}</span>
                                <!-- Add link/button to open? For now just text -->
                            </li>
                        \`;
                    });
                    
                    html += '</ul></div>';
                }

                app.innerHTML = html;
            }
        </script>
      </body>
      </html>
    `;
  }
}
