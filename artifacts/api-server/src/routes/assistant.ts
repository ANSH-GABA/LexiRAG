import { AskDocumentsBody, AskDocumentsResponse } from "@workspace/api-zod";
import {
  activitiesTable,
  db,
  documentsTable,
  workspacesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedUserId } from "../middlewares/requireAuth";
import { generateText } from "../lib/gemini";
import { retrieveEvidence, scoreForApi } from "../lib/retrieval";

const router: IRouter = Router();
const noEvidenceMessage =
  "No sufficiently relevant passages were found. Try a narrower question or choose different documents.";

router.post("/assistant/ask", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = AskDocumentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a question and choose a workspace." });
    return;
  }
  const input = parsed.data;

  const [workspace] = await db
    .select({ id: workspacesTable.id })
    .from(workspacesTable)
    .where(
      and(
        eq(workspacesTable.id, input.workspaceId),
        eq(workspacesTable.userId, userId),
      ),
    )
    .limit(1);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found." });
    return;
  }

  const selectedIds = input.documentIds
    ? [...new Set(input.documentIds)]
    : undefined;
  if (selectedIds?.length) {
    const selectedDocuments = await db
      .select({ id: documentsTable.id, status: documentsTable.status })
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.workspaceId, workspace.id),
          eq(documentsTable.ownerId, userId),
          inArray(documentsTable.id, selectedIds),
        ),
      );
    if (selectedDocuments.length !== selectedIds.length) {
      res.status(404).json({ error: "One or more selected documents were not found." });
      return;
    }
    if (selectedDocuments.some((document) => document.status !== "ready")) {
      res.status(422).json({ error: "Wait until the selected documents are indexed." });
      return;
    }
  }

  const evidence = await retrieveEvidence({
    userId,
    workspaceId: workspace.id,
    query: input.question,
    documentIds: selectedIds,
    limit: 8,
  });
  if (!evidence.length || evidence[0].score < 0.18) {
    res.status(422).json({ error: noEvidenceMessage });
    return;
  }

  const sourceById = new Map(
    evidence.map((source, index) => [`S${index + 1}`, source]),
  );
  const sourceContext = evidence
    .map(
      (source, index) =>
        `[S${index + 1}] ${JSON.stringify({ document: source.documentName, page: source.page, excerpt: source.content })}`,
    )
    .join("\n\n");
  const history = (input.history ?? [])
    .slice(-8)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");
  const generated = await generateText(
    [
      "Answer the user's question using only the source passages below.",
      "Respond in the same language as the question.",
      "Cite every material factual claim with one or more exact source IDs such as [S1]. Do not invent source IDs.",
      "If the passages do not answer the question, say that the provided documents do not establish the answer.",
      "Use conversation history only to resolve references; it is not evidence.",
      "Do not give legal or financial advice.",
      `Conversation history:\n${history || "(none)"}`,
      `Question:\n${input.question}`,
      `Source passages:\n${sourceContext}`,
    ].join("\n\n"),
  );

  const citedIds = new Set(
    [...generated.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]),
  );
  const answer = generated.replace(/\[(S\d+)\]/g, (_match, sourceId: string) => {
    const source = sourceById.get(sourceId);
    return source
      ? `[${source.documentName}, p. ${source.page}]`
      : "";
  });
  const citedEvidence =
    citedIds.size > 0
      ? evidence.filter((_source, index) => citedIds.has(`S${index + 1}`))
      : evidence.slice(0, 3);
  const response = {
    answer: answer.trim(),
    confidence: scoreForApi(evidence[0].score),
    citations: citedEvidence.map((source) => ({
      documentId: source.documentId,
      documentName: source.documentName,
      page: source.page,
      excerpt: source.excerpt,
      score: scoreForApi(source.score),
    })),
    notice:
      "AI-generated research aid, not legal or financial advice. Verify each passage in the source PDF.",
  };
  await db.insert(activitiesTable).values({
    workspaceId: workspace.id,
    userId,
    type: "question",
    title: "Asked a document question",
  });
  res.json(AskDocumentsResponse.parse(response));
});

export default router;