import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.integer("age").nullable(); // age?: number
    table.dropColumn("firstName");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("age");
    table.string("firstName").notNullable();
  });
}
