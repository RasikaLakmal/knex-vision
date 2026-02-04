import knex, { Knex } from "knex";
import * as path from "path";
import * as fs from "fs";

export class DbConnectionService {
  private static _knex: Knex | undefined;
  private static _output: any | undefined;

  public static setLogger(logger: any) {
    this._output = logger;
  }

  public static isConnected(): boolean {
    return !!this._knex;
  }

  private static log(msg: string) {
    console.log(msg);
    if (this._output) {
      this._output.appendLine(`[DB] ${msg}`);
    }
  }

  private static error(msg: string, err?: any) {
    console.error(msg, err);
    if (this._output) {
      this._output.appendLine(
        `[DB] [ERROR] ${msg} ${err ? JSON.stringify(err.message || err) : ""}`,
      );
    }
  }

  public static async connect(projectRoot: string): Promise<boolean> {
    try {
      if (this._knex) {
        return true;
      }

      this.log("Connecting to Database...");
      const config = await this.loadKnexConfig(projectRoot);

      if (!config) {
        this.log(
          "No knex config found (checked knexfile, settings, and .env).",
        );
        return false;
      }

      this.log(`Attempting connection with client: ${config.client}`);

      this._knex = knex(config);

      // Test connection
      await this._knex.raw("SELECT 1");
      this.log("Database connected successfully.");
      return true;
    } catch (e) {
      this.error("Database connection failed:", e);
      this._knex = undefined;
      return false;
    }
  }

  public static async getExecutedMigrations(): Promise<Set<string>> {
    if (!this._knex) {
      return new Set();
    }

    try {
      const config = this._knex.client.config;
      const tableName = config.migrations?.tableName || "knex_migrations";

      this.log(`Checking executed migrations in table: ${tableName}`);

      const exists = await this._knex.schema.hasTable(tableName);
      if (!exists) {
        this.log(`Migration table '${tableName}' does not exist.`);
        return new Set();
      }

      const result = await this._knex(tableName).select("name");
      const names = result.map((r: any) => r.name);
      this.log(
        `Found ${names.length} executed migrations: ${names.slice(0, 5).join(", ")}${names.length > 5 ? "..." : ""}`,
      );
      return new Set(names);
    } catch (e) {
      this.error("Failed to fetch executed migrations:", e);
      return new Set();
    }
  }

  public static async close() {
    if (this._knex) {
      await this._knex.destroy();
      this._knex = undefined;
    }
  }

  private static async loadKnexConfig(projectRoot: string): Promise<any> {
    // 0. Pre-load Environment Variables (.env) so knexfile can use them
    this.preloadEnv(projectRoot);

    // 1. Try standard locations
    const possiblePaths = [
      path.join(projectRoot, "knexfile.ts"),
      path.join(projectRoot, "knexfile.js"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        this.log(`Loading knex config from ${p}`);

        try {
          if (p.endsWith(".ts")) {
            console.warn(
              "Found knexfile.ts but loading TS files directly is not fully supported in extension runtime unless compiled.",
            );
          }

          // Clear cache to ensure we get fresh config if file changed or env vars changed
          delete require.cache[require.resolve(p)];
          const config = require(p);
          return config.development || config;
        } catch (e) {
          this.error("Failed to load knexfile:", e);
        }
      }
    }

    // 2. Fallback to VS Code Configuration
    const settingsConfig = this.loadConfigFromSettings();
    if (settingsConfig) {
      return settingsConfig;
    }

    // 3. Fallback to Environment Variables (.env)
    return this.loadConfigFromEnv(projectRoot);
  }

  private static preloadEnv(projectRoot: string) {
    const dotenvPath = path.join(projectRoot, ".env");
    if (fs.existsSync(dotenvPath)) {
      this.log(`Pre-loading .env from ${dotenvPath}`);
      // Force reload env vars to pick up changes
      require("dotenv").config({ path: dotenvPath, override: true });
    }
  }

  private static loadConfigFromEnv(projectRoot: string): any {
    // Ensure it's loaded
    this.preloadEnv(projectRoot);

    // Check for DATABASE_URL
    if (process.env.DATABASE_URL) {
      this.log("Found DATABASE_URL in environment.");
      return {
        client: "pg", // Default to PG if not specified
        connection: {
          connectionString: process.env.DATABASE_URL,
          ssl:
            process.env.DB_SSL === "true"
              ? { rejectUnauthorized: false }
              : false,
        },
      };
    }

    // Check for individual fields
    if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
      this.log("Found DB_* variables in environment.");
      return {
        client: process.env.DB_CLIENT || "pg",
        connection: {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT) || 5432,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          ssl:
            process.env.DB_SSL === "true"
              ? { rejectUnauthorized: false }
              : false,
        },
      };
    }
    return null;
  }

  private static loadConfigFromSettings(): any {
    const vscode = require("vscode");
    const config = vscode.workspace.getConfiguration("knexVision.database");

    // Standard settings
    const dbName = config.get("database");
    const user = config.get("user");

    // Connection string setting
    const connectionString = config.get("connectionString");

    if (connectionString) {
      this.log("Loading connectionString from VS Code settings.");
      return {
        client: config.get("client", "pg"),
        connection: {
          connectionString,
          ssl: config.get("ssl") ? { rejectUnauthorized: false } : false,
        },
      };
    }

    if (dbName && user) {
      this.log("Loading knex config from VS Code settings.");
      return {
        client: config.get("client", "pg"),
        connection: {
          host: config.get("host"),
          port: config.get("port"),
          user: user,
          password: config.get("password"),
          database: dbName,
          ssl: config.get("ssl") ? { rejectUnauthorized: false } : false,
        },
      };
    }
    return null;
  }
}
