import * as vscode from "vscode";
import { TsModelGenerator } from "../utils/TsModelGenerator";

export class MigrationPreviewPanel {
  public static currentPanel: MigrationPreviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _lastMigration: any;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getWebviewContent(this._panel.webview);

    // Listen for when the webview is ready
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === "ready") {
          if (this._lastMigration) {
            this.update(this._lastMigration);
          }
        }
      },
      null,
      this._disposables,
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

  public setLoading(isLoading: boolean) {
    this._panel.webview.postMessage({
      command: "setLoading",
      value: isLoading,
    });
  }

  public update(migration: any) {
    this._lastMigration = migration; // Buffer it

    let tsModels = "";
    let errorMessage: string | undefined;

    if (migration && !migration.errorMessage) {
      try {
        tsModels = TsModelGenerator.generate(migration);
      } catch (e: any) {
        errorMessage = `Failed to generate TS models: ${e.message}`;
        tsModels = "// Error generating models. See console.";
      }
    } else if (migration && migration.errorMessage) {
      errorMessage = migration.errorMessage;
    }

    this._panel.webview.postMessage({
      command: "update",
      migration: { ...migration, tsModels, errorMessage },
    });
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

  private _getWebviewContent(webview: vscode.Webview) {
    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Migration Preview</title>
        <style>
          body { font-family: sans-serif; padding: 20px; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); position: relative; min-height: 100vh; }
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
          .ts-model-container { margin-top: 20px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 5px; }
          .copy-btn { float: right; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; border-radius: 3px; }
          
          /* Loading Overlay */
          #loading-overlay {
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background: var(--vscode-editor-background);
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              z-index: 1000;
              transition: opacity 0.3s ease-in-out;
          }
          .loader {
            border: 4px solid var(--vscode-editor-inactiveSelectionBackground);
            border-top: 4px solid var(--vscode-button-background);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-bottom: 15px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .hidden {
              opacity: 0;
              pointer-events: none;
          }

          /* Error Display */
          .error-container {
              color: var(--vscode-errorForeground);
              border: 1px solid var(--vscode-errorForeground);
              padding: 20px;
              border-radius: 5px;
              background: rgba(255,0,0,0.1);
              margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div id="loading-overlay">
            <div class="loader"></div>
            <div id="loading-text">Loading Migration Preview...</div>
        </div>
        
        <div id="error-display" style="display: none;"></div>
        
        <div id="app"></div>

        <script>
            const vscode = acquireVsCodeApi();
            const loadingOverlay = document.getElementById('loading-overlay');
            const errorDisplay = document.getElementById('error-display');
            const app = document.getElementById('app');
            
            // Global Error Handler
            window.onerror = function(message, source, lineno, colno, error) {
                showError(\`Internal Webview Error: \${message}\`);
                return false;
            };

            // Signal ready
            vscode.postMessage({ command: 'ready' });

            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.command) {
                    case 'setLoading':
                        setLoading(message.value);
                        break;
                    case 'update':
                        setLoading(false);
                        renderMigration(message.migration);
                        break;
                }
            });

            function setLoading(isLoading) {
                if (isLoading) {
                    loadingOverlay.classList.remove('hidden');
                    errorDisplay.style.display = 'none';
                    app.style.display = 'none';
                } else {
                    loadingOverlay.classList.add('hidden');
                    app.style.display = 'block';
                }
            }

            function showError(msg) {
                setLoading(false);
                app.style.display = 'none';
                errorDisplay.style.display = 'block';
                errorDisplay.innerHTML = \`<div class="error-container">
                    <h3>Error</h3>
                    <pre>\${msg}</pre>
                </div>\`;
            }

            function renderMigration(migration) {
                if (!migration) {
                    app.innerHTML = '<h1>No migration data</h1>';
                    return;
                }
                
                try {
                    // Check for migration-level errors first
                    if (migration.errorMessage) {
                         showError(migration.errorMessage);
                         return; // Stop rendering if there's a critical error
                    }

                    let statusBadge = '';
                    if (migration.isExecuted !== undefined) {
                      if (migration.isExecuted) {
                         statusBadge = '<span class="badge" style="background-color: var(--vscode-notebook-cellEditorBackground); color: var(--vscode-notebook-statusSuccessIcon-foreground); border: 1px solid var(--vscode-notebook-statusSuccessIcon-foreground); margin-left: 10px;">Executed</span>';
                      } else {
                         statusBadge = '<span class="badge" style="background-color: var(--vscode-notebook-cellEditorBackground); color: var(--vscode-notebook-statusErrorIcon-foreground); border: 1px solid var(--vscode-notebook-statusErrorIcon-foreground); margin-left: 10px;">Pending</span>';
                      }
                    }

                    let html = \`
                        <div class="migration-header">
                            \${migration.name || 'Unknown'} (\${migration.id || '?'})
                            \${statusBadge}
                        </div>
                    \`;

                    html += \`
                        <div class="timeline">
                            <div>Functions: Up \${migration.hasUp ? '✅' : '❌'}, Down \${migration.hasDown ? '✅' : '❌'}</div>
                        </div>
                    \`;

                    html += '<h2>Schema Changes</h2>';

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
                                        let nullableInfo = '';
                                        if (col.isNullable === false) nullableInfo = '<span style="opacity:0.5; font-size:0.8em"> NOT NULL</span>';
                                        
                                        html += \`<div class="column-change">
                                            <span class="badge \${colBadge}">\${col.changeType.toUpperCase()}</span>
                                            \${col.columnName} <span style="opacity: 0.7">(\${col.type})</span>\${extra}\${nullableInfo}
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

                    if (migration.fullSchema) {
                        html += '<div style="margin-top: 30px; border-top: 1px solid var(--vscode-widget-border); padding-top: 20px;">';
                        html += '<h2>Full Table Snapshot</h2>';
                        
                        const affectedTableNames = new Set(
                             (migration.diff?.tables || []).map(t => t.tableName)
                        );
                        const tables = Object.values(migration.fullSchema).filter(t => affectedTableNames.has(t.tableName));

                        if (tables.length === 0) {
                             html += '<p style="opacity: 0.7">No table definitions found for modified tables.</p>';
                        } else {
                            tables.forEach((table) => {
                                 html += \`
                                    <div class="table-change" style="border: 1px solid var(--vscode-widget-border); padding: 10px; border-radius: 5px; margin-bottom: 20px;">
                                        <h3 style="margin-top: 0;">\${table.tableName}</h3>
                                \`;
                                
                                if (table.columns && table.columns.length > 0) {
                                    html += '<div>';
                                       table.columns.forEach((col) => {
                                        let extra = '';
                                        if (col.foreignKey) {
                                            extra = \` <span style="color: var(--vscode-textLink-activeForeground);">→ \${col.foreignKey.inTable}.\${col.foreignKey.references}</span>\`;
                                        }
                                        let nullableInfo = '';
                                        if (col.isNullable === false) nullableInfo = '<span style="opacity:0.5; font-size:0.8em; margin-left: 5px;">NOT NULL</span>';
                                        
                                        html += \`<div class="column-change">
                                            \${col.name} <span style="opacity: 0.7">(\${col.type})</span>\${extra}\${nullableInfo}
                                        </div>\`;
                                    });   
                                    html += '</div>';
                                } else {
                                    html += '<div style="opacity: 0.7; margin-left: 20px;">(No columns)</div>';
                                }
                                
                                html += '</div>';
                            });
                        }
                        html += '</div>';
                    }

                    if (migration.tsModels) {
                         html += \`
                            <div class="ts-model-container">
                                <button class="copy-btn" onclick="navigator.clipboard.writeText(this.parentNode.querySelector('pre').innerText)">Copy</button>
                                <h3>TypeScript Model</h3>
                                <pre><code class="language-typescript">\${migration.tsModels}</code></pre>
                            </div>
                         \`;
                    }

                    app.innerHTML = html;
                } catch (e) {
                    showError(\`Rendering Error: \${e.message}\`);
                }
            }
        </script>
      </body>
      </html>
    `;
  }
}
