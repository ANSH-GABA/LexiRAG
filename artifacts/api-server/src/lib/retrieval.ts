import { db, documentChunksTable, documentsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { embedText } from "./gemini";

export interface Evidence {
  documentId: string;
  documentName: string;
  page: number;
  excerpt: string;
  score: number;
  content: string;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function retrieveEvidence({
  userId,
  workspaceId,
  query,
  documentIds,
  limit = 8,
}: {
  userId: string;
  workspaceId: string;
  query: string;
  documentIds?: string[];
  limit?: number;
}): Promise<Evidence[]> {
  const queryEmbedding = await embedText(query, "RETRIEVAL_QUERY");
  const conditions = [
    eq(documentChunksTable.ownerId, userId),
    eq(documentChunksTable.workspaceId, workspaceId),
    eq(documentsTable.ownerId, userId),
    eq(documentsTable.workspaceId, workspaceId),
    eq(documentsTable.status, "ready"),
  ];
  if (documentIds?.length) {
    conditions.push(inArray(documentChunksTable.documentId, documentIds));
  }

  const rows = await db
    .select({
      chunk: documentChunksTable,
      documentName: documentsTable.name,
    })
    .from(documentChunksTable)
    .innerJoin(
      documentsTable,
      eq(documentChunksTable.documentId, documentsTable.id),
    )
    .where(and(...conditions));

  return rows
    .map(({ chunk, documentName }) => ({
      documentId: chunk.documentId,
      documentName,
      page: chunk.page,
      content: chunk.content,
      excerpt: chunk.content.slice(0, 850),
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function scoreForApi(score: number): number {
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}