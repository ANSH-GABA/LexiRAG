import {
  CreateDocumentBody,
  CreateDocumentResponse,
  DeleteDocumentParams,
  GetDocumentParams,
  GetDocumentResponse,
  IndexDocumentParams,
  IndexDocumentResponse,
  ListDocumentsQueryParams,
  ListDocumentsResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  db,
  documentChunksTable,
  documentsTable,
  workspacesTable,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedUserId } from "../middlewares/requireAuth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { serializeDocument } from "../lib/serializers";
import { chunkPdfPages, extractPdfPages } from "../lib/pdfIndexing";
import { embedText } from "../lib/gemini";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const maximumUploadSize = 50 * 1024 * 1024;
const maximumIndexedChunks = 300;

function ownerObjectSegment(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function findOwnedDocument(documentId: string, userId: string) {
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, documentId),
        eq(documentsTable.ownerId, userId),
      ),
    )
    .limit(1);
  return document;
}

async function runIndexing(
  document: typeof documentsTable.$inferSelect,
): Promise<void> {
  try {
    const object = await objectStorage.getObjectEntityFile(document.objectPath);
    const [bytes] = await object.download();
    if (bytes.byteLength > maximumUploadSize) {
      throw new Error("The uploaded PDF exceeds the 50 MB indexing limit.");
    }

    const pages = await extractPdfPages(bytes);
    const chunks = chunkPdfPages(pages);
    if (!chunks.length) {
      throw new Error(
        "No selectable text was found. Scanned PDFs need OCR before indexing.",
      );
    }
    if (chunks.length > maximumIndexedChunks) {
      throw new Error(
        `This PDF creates more than ${maximumIndexedChunks} searchable passages. Split it into smaller files and retry.`,
      );
    }

    const embeddings: number[][] = new Array(chunks.length);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= chunks.length) return;
        embeddings[index] = await embedText(
          chunks[index].content,
          "RETRIEVAL_DOCUMENT",
        );
      }
    };
    await Promise.all([worker(), worker()]);

    await db.delete(documentChunksTable).where(eq(documentChunksTable.documentId, document.id));
    for (let start = 0; start < chunks.length; start += 30) {
      const values = chunks.slice(start, start + 30).map((chunk, offset) => ({
        documentId: document.id,
        workspaceId: document.workspaceId,
        ownerId: document.ownerId,
        page: chunk.page,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        embedding: embeddings[start + offset],
      }));
      await db.insert(documentChunksTable).values(values);
    }

    await db
      .update(documentsTable)
      .set({
        status: "ready",
        pageCount: pages.length,
        chunkCount: chunks.length,
        language: null,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(documentsTable.id, document.id));
    await db.insert(activitiesTable).values({
      workspaceId: document.workspaceId,
      userId: document.ownerId,
      type: "index",
      title: `Indexed ${document.name}`,
    });
  } catch (error) {
    const message =
      error instanceof Error &&
      (error.message.includes("selectable text") ||
        error.message.includes("50 MB") ||
        error.message.includes("searchable passages"))
        ? error.message
        : "Indexing failed. Check the Gemini API configuration and retry.";
    await db
      .delete(documentChunksTable)
      .where(eq(documentChunksTable.documentId, document.id));
    await db
      .update(documentsTable)
      .set({
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(documentsTable.id, document.id));
    console.error("LexiRAG document indexing failed", {
      documentId: document.id,
      category: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

router.get("/documents", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = ListDocumentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a workspace." });
    return;
  }

  const [workspace] = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable)
    .where(
      and(
        eq(workspacesTable.id, parsed.data.workspaceId),
        eq(workspacesTable.userId, userId),
      ),
    )
    .limit(1);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found." });
    return;
  }

  const documents = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.workspaceId, workspace.id),
        eq(documentsTable.ownerId, userId),
      ),
    )
    .orderBy(asc(documentsTable.name));
  res.json(ListDocumentsResponse.parse(documents.map(serializeDocument)));
});

router.post("/documents", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = CreateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The uploaded PDF details are invalid." });
    return;
  }

  const { workspaceId, objectPath } = parsed.data;
  const name = parsed.data.name
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ownerPrefix = `/objects/uploads/${ownerObjectSegment(userId)}/`;
  if (!objectPath.startsWith(ownerPrefix)) {
    res.status(403).json({ error: "This upload does not belong to your account." });
    return;
  }

  const [workspace] = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable)
    .where(
      and(
        eq(workspacesTable.id, workspaceId),
        eq(workspacesTable.userId, userId),
      ),
    )
    .limit(1);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found." });
    return;
  }

  try {
    const object = await objectStorage.getObjectEntityFile(objectPath);
    const [metadata] = await object.getMetadata();
    const actualSize = Number(metadata.size);
    if (
      !Number.isFinite(actualSize) ||
      actualSize < 1 ||
      actualSize > maximumUploadSize ||
      actualSize !== parsed.data.size ||
      metadata.contentType !== "application/pdf"
    ) {
      await object.delete({ ignoreNotFound: true });
      res.status(400).json({
        error: "The uploaded file does not match the PDF details or 50 MB limit.",
      });
      return;
    }

    await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
      owner: userId,
      visibility: "private",
    });
    const [document] = await db
      .insert(documentsTable)
      .values({
        workspaceId,
        ownerId: userId,
        name: name || "Untitled PDF",
        objectPath,
        mimeType: "application/pdf",
        size: actualSize,
        status: "uploaded",
      })
      .returning();
    await db.insert(activitiesTable).values({
      workspaceId,
      userId,
      type: "upload",
      title: `Uploaded ${document.name}`,
    });
    res.status(201).json(
      CreateDocumentResponse.parse(serializeDocument(document)),
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Uploaded file not found." });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(400).json({ error: "This upload has already been registered." });
      return;
    }
    throw error;
  }
});

router.get("/documents/:documentId", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = GetDocumentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  const document = await findOwnedDocument(parsed.data.documentId, userId);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  res.json(GetDocumentResponse.parse(serializeDocument(document)));
});

router.post(
  "/documents/:documentId/index",
  async (req: Request, res: Response) => {
    const userId = authenticatedUserId(res);
    const parsed = IndexDocumentParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const document = await findOwnedDocument(parsed.data.documentId, userId);
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    if (document.status === "indexing") {
      res.json(IndexDocumentResponse.parse(serializeDocument(document)));
      return;
    }

    const [updated] = await db
      .update(documentsTable)
      .set({
        status: "indexing",
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(documentsTable.id, document.id))
      .returning();
    res.json(IndexDocumentResponse.parse(serializeDocument(updated)));
    void runIndexing(updated);
  },
);

router.delete(
  "/documents/:documentId",
  async (req: Request, res: Response) => {
    const userId = authenticatedUserId(res);
    const parsed = DeleteDocumentParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    const document = await findOwnedDocument(parsed.data.documentId, userId);
    if (!document) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    try {
      const object = await objectStorage.getObjectEntityFile(document.objectPath);
      await object.delete({ ignoreNotFound: true });
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
    await db.delete(documentsTable).where(eq(documentsTable.id, document.id));
    await db.insert(activitiesTable).values({
      workspaceId: document.workspaceId,
      userId,
      type: "upload",
      title: `Deleted ${document.name}`,
    });
    res.status(204).end();
  },
);

export default router;