import { createInsertSchema } from "drizzle-zod";
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { documentsTable } from "./documents";
import { workspacesTable } from "./workspaces";

export const analysesTable = pgTable(
  "lexirag_analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    documentId: uuid("document_id").references(() => documentsTable.id, {
      onDelete: "set null",
    }),
    secondaryDocumentId: uuid("secondary_document_id").references(
      () => documentsTable.id,
      { onDelete: "set null" },
    ),
    analysisType: varchar("analysis_type", {
      enum: ["clauses", "deadlines", "financial", "comparison"],
    }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    results: jsonb("results").$type<unknown[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lexirag_analyses_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("lexirag_analyses_owner_type_created_idx").on(
      table.ownerId,
      table.analysisType,
      table.createdAt,
    ),
  ],
);

export const insertAnalysisSchema = createInsertSchema(analysesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalysis = typeof analysesTable.$inferInsert;
export type Analysis = typeof analysesTable.$inferSelect;