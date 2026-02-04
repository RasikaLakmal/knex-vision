import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary().defaultTo(knex.fn.uuid()); // id!: string
    table.string("username").notNullable().unique(); // username!: string
    table.string("email").notNullable().unique(); // email!: string
    table.string("firstName").notNullable(); // firstName!: string
    table.string("lastName").notNullable(); // lastName!: string
    table.integer("roleId").notNullable(); // roleId!: number
    table.string("countryCode").notNullable(); // countryCode!: string
    table.boolean("emailVerified").defaultTo(false); // emailVerified!: boolean
    table.string("timezone").nullable(); // timezone!: string
    table.timestamps(true, true); // createdAt, updatedAt!: Date

    // Optional/Nullable fields
    table.string("avatarUrl").nullable(); // avatarUrl?: string
    table.boolean("deleted").defaultTo(false); // deleted?: boolean

    // Foreign keys (representing relations like role?: Role or billingAddress?)
    // In database terms, these are just columns, but the model implies relations.
    // table.foreign('roleId').references('roles.id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("users");
}
