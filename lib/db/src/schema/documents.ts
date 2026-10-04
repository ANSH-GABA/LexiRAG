import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { workspacesTable } from "./workspaces";

export const documentsTable = pgTable(
  "lexirag_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    objectPath: text("object_path").notNull().unique(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    size: integer("size").notNull(),
    status: varchar("status", {
      enum: ["uploaded", "indexing", "ready", "failed"],
    })
      .notNull()
      .default("uploaded"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    language: varchar("language", { length: 40 }),
    error: text("error"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("lexirag_documents_workspace_owner_idx").on(table.workspaceId, table.ownerId),
    index("lexirag_documents_owner_idx").on(table.ownerId),
  ],
);

export const documentChunksTable = pgTable(
  "lexirag_document_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspacesTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    page: integer("page").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lexirag_document_chunks_document_index_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("lexirag_document_chunks_workspace_owner_idx").on(
      table.workspaceId,
      table.ownerId,
    ),
  ],
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  uploadedAt: true,
  updatedAt: true,
});

export type InsertDocument = typeof documentsTable.$inferInsert;
export type Document = typeof documentsTable.$inferSelect;
export type DocumentChunk = typeof documentChunksTable.$inferSelect;