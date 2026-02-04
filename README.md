# Knex Vision

**Knex Vision** is a VS Code extension designed to supercharge your Knex.js development workflow. Inspect, visualize, and validate your migrations without leaving your editor.

![Knex Vision Preview](https://github.com/rasikalakmal/knex-vision/raw/main/media/preview.gif)

## 🚀 Features

### 1. **Migration Explorer**

Visualize your migration files in a dedicated Sidebar View.

- **Timeline View**: See migrations sorted by their timestamp.
- **Status Indicators**: Instantly spot executed (✅) vs pending (⚪) migrations (requires DB connection).
- **Health Check**: Detects basic issues like missing `down` methods.

### 2. **Interactive Preview Panel**

Click on any migration in the sidebar to open a rich preview.
**Or use the Command Palette**: Open a migration file and run `> Knex Vision: Preview Migration`.

- **Schema Changes**: See exactly which tables and columns are created, altered, or dropped.
- **Visual Diff**: Color-coded badges (`CREATE`, `ALTER`, `DROP`) make changes obvious.
- **Raw SQL**: View any raw SQL queries embedded in your migrations.
- **Indexes & Views**: Detects `CREATE INDEX` and `CREATE MATERIALIZED VIEW` statements.

### 3. **Time-Travel Schema Replay**

Knex Vision parses your _entire_ migration history to reconstruct the database schema at any point in time.

- **Full Table Snapshot**: See the complete definition of a table (all columns, even from previous migrations) as it exists after the current migration is applied.

### 4. **Auto-Generated TypeScript Models**

Stop manually typing interfaces!

- **Instant Models**: The preview panel automatically generates TypeScript interfaces for every table modified in the migration.
- **Copy & Paste**: One-click copy to drop straight into your codebase.

### 5. **Robust Database Integration**

- **Auto-Config**: Automatically detects `knexfile.ts`, `knexfile.js`, or `.env` variables (`DATABASE_URL`, `DB_HOST`, etc.).
- **Lazy Connection**: Connects to your database only when needed, ensuring fast VS Code startup.
- **Execution Status**: Syncs with your `knex_migrations` table to show which files have actually run.

---

## ⚙️ Configuration

Knex Vision attempts to auto-discover your configuration, but you can also configure it explicitly in `.vscode/settings.json`:

```json
{
  "knexVision.database.client": "pg",
  "knexVision.database.connectionString": "postgres://user:pass@localhost:5432/dbname"
}
```

Or using detailed fields:

```json
{
  "knexVision.database.client": "pg",
  "knexVision.database.host": "localhost",
  "knexVision.database.port": 5432,
  "knexVision.database.user": "postgres",
  "knexVision.database.password": "secret",
  "knexVision.database.database": "my_db"
}
```

### Supported Logics for Config Loading (Priority Order):

1.  **`knexfile.ts` / `knexfile.js`**: Checks the root of your workspace.
2.  **VS Code Settings**: Looks at `knexVision.database.*`.
3.  **`.env` File**: Looks for `DATABASE_URL` or individual `DB_*` variables.

---

## ⚡ Requirements

- **Knex.js**: Your project should use Knex.js.
- **Database**: Currently optimized for **PostgreSQL**, but supports basic visualization for other dialects supported by Knex.

---

## 🛠️ Known Issues & Limitations

- Complex raw SQL parsing is "best-effort" (regex-based).
- `knexfile.ts` executing TS directly might require `ts-node` or similar in your environment (the extension tries to handle this gracefully).

---

## 👨‍💻 Contributing

This project is open source!
**Repository**: [https://github.com/rasikalakmal/knex-vision](https://github.com/rasikalakmal/knex-vision)

1.  Fork it.
2.  Create your feature branch (`git checkout -b feature/cool-feature`).
3.  Commit your changes (`git commit -am 'Add cool feature'`).
4.  Push to the branch (`git push origin feature/cool-feature`).
5.  Create a new Pull Request.

---

**Enjoy building with Knex Vision!**
