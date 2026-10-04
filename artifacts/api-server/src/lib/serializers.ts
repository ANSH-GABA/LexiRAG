import type { Document as DbDocument, Workspace as DbWorkspace } from "@workspace/db";

export function serializeDocument(document: DbDocument) {
  return {
    id: document.id,
    workspaceId: document.workspaceId,
    name: document.name,
    objectPath: document.objectPath,
    mimeType: document.mimeType,
    size: document.size,
    status: document.status,
    pageCount: document.pageCount,
    chunkCount: document.chunkCount,
    language: document.language,
    uploadedAt: document.uploadedAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    error: document.error,
  };
}

export function serializeWorkspace(
  workspace: DbWorkspace,
  documentCount: number,
) {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt.toISOString(),
    documentCount,
  };
}