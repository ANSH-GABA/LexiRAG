import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const activitiesTable = pgTable(
  "lexirag_activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    type: varchar("type", {
      enum: ["upload", "index", "question", "comparison", "extraction"],
    }).notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lexirag_activities_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertActivity = typeof activitiesTable.$inferInsert;
export type Activity = typeof activitiesTable.$inferSelect;