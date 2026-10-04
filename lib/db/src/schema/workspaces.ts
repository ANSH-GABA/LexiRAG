import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const workspacesTable = pgTable(
  "lexirag_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lexirag_workspaces_user_idx").on(table.userId),
    uniqueIndex("lexirag_workspaces_user_name_idx").on(table.userId, table.name),
  ],
);

export const insertWorkspaceSchema = createInsertSchema(workspacesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertWorkspace = typeof workspacesTable.$inferInsert;
export type Workspace = typeof workspacesTable.$inferSelect;