import {
  CompareDocumentsBody,
  CompareDocumentsResponse,
  ExtractDocumentBody,
  ExtractDocumentResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  analysesTable,
  db,
  documentsTable,
  workspacesTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedUserId } from "../middlewares/requireAuth";
import { generateText } from "../lib/gemini";
import { parseJsonObject } from "../lib/pdfIndexing";
import { retrieveEvidence, scoreForApi, type Evidence } from "../lib/retrieval";

const router: IRouter = Router();

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function parseSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && /^[AB]?\d+$/.test(item),
  );
}

function citationFromEvidence(source: Evidence) {
  return {
    documentId: source.documentId,
    documentName: source.documentName,
    page: source.page,
    excerpt: source.excerpt,
    score: scoreForApi(source.score),
  };
}

async function ownedWorkspace(workspaceId: string, userId: string) {
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
  return workspace;
}

router.post("/analysis/compare", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = CompareDocumentsBody.safeParse(req.body);
  if (!parsed.success || parsed.data.documentAId === parsed.data.documentBId) {
    res.status(400).json({ error: "Choose two different indexed documents." });
    return;
  }
  const input = parsed.data;

  const workspace = await ownedWorkspace(input.workspaceId, userId);
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
        inArray(documentsTable.id, [input.documentAId, input.documentBId]),
      ),
    );
  if (documents.length !== 2) {
    res.status(404).json({ error: "One or both documents were not found." });
    return;
  }
  if (documents.some((document) => document.status !== "ready")) {
    res.status(422).json({ error: "Wait until both documents are indexed." });
    return;
  }
  const documentA = documents.find((document) => document.id === input.documentAId)!;
  const documentB = documents.find((document) => document.id === input.documentBId)!;

  const [evidenceA, evidenceB] = await Promise.all([
    retrieveEvidence({
      userId,
      workspaceId: workspace.id,
      query: input.criterion,
      documentIds: [documentA.id],
      limit: 5,
    }),
    retrieveEvidence({
      userId,
      workspaceId: workspace.id,
      query: input.criterion,
      documentIds: [documentB.id],
      limit: 5,
    }),
  ]);
  if (!evidenceA.length && !evidenceB.length) {
    res.status(422).json({ error: "No matching evidence was found in either document." });
    return;
  }

  const sourceMap = new Map<string, Evidence>();
  const formatSource = (prefix: "A" | "B", sources: Evidence[]) =>
    sources
      .map((source, index) => {
        const sourceId = `${prefix}${index + 1}`;
        sourceMap.set(sourceId, source);
        return `[${sourceId}] ${JSON.stringify({ page: source.page, excerpt: source.content })}`;
      })
      .join("\n\n");
  const sourceContext = [
    `Document A: ${documentA.name}\n${formatSource("A", evidenceA) || "(no matching passage found)"}`,
    `Document B: ${documentB.name}\n${formatSource("B", evidenceB) || "(no matching passage found)"}`,
  ].join("\n\n");
  const generated = parseJsonObject(
    await generateText(
      [
        "Compare the two documents only on the user's requested criterion.",
        "Return JSON with exactly: summary (string), rows (array). Each row must contain aspect, documentA, documentB, difference (strings), sourcesA and sourcesB (arrays of exact source IDs from the supplied passages).",
        "Do not invent clauses, values, dates, or source IDs. An empty source array is allowed only when that document does not establish the comparison.",
        "Do not provide legal or financial advice.",
        `Criterion: ${input.criterion}`,
        `Passages:\n${sourceContext}`,
      ].join("\n\n"),
      "application/json",
    ),
  );
  const rawRows = Array.isArray(generated.rows) ? generated.rows : [];
  const rows = rawRows.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const sourceIdsA = parseSourceIds(row.sourcesA).filter((id) =>
      sourceMap.has(id),
    );
    const sourceIdsB = parseSourceIds(row.sourcesB).filter((id) =>
      sourceMap.has(id),
    );
    if (!sourceIdsA.length && !sourceIdsB.length) return [];
    return [
      {
        aspect: stringField(row.aspect, input.criterion),
        documentA: stringField(row.documentA, "Not established in the provided passages."),
        documentB: stringField(row.documentB, "Not established in the provided passages."),
        difference: stringField(row.difference, "No supported comparison was returned."),
        citationsA: sourceIdsA.map((id) => citationFromEvidence(sourceMap.get(id)!)),
        citationsB: sourceIdsB.map((id) => citationFromEvidence(sourceMap.get(id)!)),
      },
    ];
  });
  const output = {
    summary: stringField(
      generated.summary,
      "The model did not return a comparison summary.",
    ),
    rows,
  };
  const validated = CompareDocumentsResponse.parse(output);

  await db.insert(analysesTable).values({
    workspaceId: workspace.id,
    ownerId: userId,
    documentId: documentA.id,
    secondaryDocumentId: documentB.id,
    analysisType: "comparison",
    title: `Compared ${documentA.name} and ${documentB.name}`,
    summary: validated.summary,
    results: validated.rows,
  });
  await db.insert(activitiesTable).values({
    workspaceId: workspace.id,
    userId,
    type: "comparison",
    title: `Compared ${documentA.name} and ${documentB.name}`,
  });
  res.json(validated);
});

router.post("/analysis/extract", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = ExtractDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a document and extraction type." });
    return;
  }
  const input = parsed.data;
  const workspace = await ownedWorkspace(input.workspaceId, userId);
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found." });
    return;
  }

  const [document] = await db
    .select()
    .from(documentsTable)
    .where(
      and(
        eq(documentsTable.id, input.documentId),
        eq(documentsTable.workspaceId, workspace.id),
        eq(documentsTable.ownerId, userId),
      ),
    )
    .limit(1);
  if (!document) {
    res.status(404).json({ error: "Document not found." });
    return;
  }
  if (document.status !== "ready") {
    res.status(422).json({ error: "Index this document before extracting information." });
    return;
  }

  const prompts = {
    clauses:
      "Find material legal clauses and obligations, including termination, renewal, indemnity, liability, confidentiality, governing law, and unusual terms.",
    deadlines:
      "Find dated obligations, renewal and notice deadlines, filing dates, payment due dates, and expiration dates. Return an exact ISO YYYY-MM-DD date only when the document supports it.",
    financial:
      "Find financial figures and terms, including fees, rates, payment schedules, caps, penalties, amounts, and currencies.",
  } as const;
  const evidence = await retrieveEvidence({
    userId,
    workspaceId: workspace.id,
    query: prompts[input.analysisType],
    documentIds: [document.id],
    limit: 18,
  });
  if (!evidence.length) {
    res.status(422).json({ error: "No searchable passages were found in this document." });
    return;
  }
  const sources = new Map(
    evidence.map((source, index) => [`S${index + 1}`, source]),
  );
  const sourceContext = evidence
    .map(
      (source, index) =>
        `[S${index + 1}] ${JSON.stringify({ page: source.page, excerpt: source.content })}`,
    )
    .join("\n\n");
  const generated = parseJsonObject(
    await generateText(
      [
        prompts[input.analysisType],
        "Return JSON with exactly: summary (string), items (array). Each item must contain label, value, date (ISO YYYY-MM-DD or null), riskLevel (low, medium, high, or null), and sourceId (one exact supplied ID).",
        "Every item must be supported by its cited passage. Do not infer dates or risk levels that the source does not support. If there are no relevant items, return an empty array.",
        "Do not provide legal or financial advice.",
        `Document: ${document.name}`,
        `Passages:\n${sourceContext}`,
      ].join("\n\n"),
      "application/json",
    ),
  );

  const rawItems = Array.isArray(generated.items) ? generated.items : [];
  const items = rawItems.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const source =
      typeof item.sourceId === "string" ? sources.get(item.sourceId) : undefined;
    if (!source) return [];
    const date =
      typeof item.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
      !Number.isNaN(Date.parse(`${item.date}T00:00:00Z`))
        ? item.date
        : null;
    const riskLevel =
      item.riskLevel === "low" ||
      item.riskLevel === "medium" ||
      item.riskLevel === "high"
        ? item.riskLevel
        : null;
    return [
      {
        label: stringField(item.label, "Extracted item"),
        value: stringField(item.value),
        date,
        riskLevel,
        citation: citationFromEvidence(source),
      },
    ];
  });
  const output = {
    analysisType: input.analysisType,
    summary: stringField(
      generated.summary,
      "No supported items were identified in the selected passages.",
    ),
    items,
  };
  const validated = ExtractDocumentResponse.parse(output);

  await db.insert(analysesTable).values({
    workspaceId: workspace.id,
    ownerId: userId,
    documentId: document.id,
    analysisType: input.analysisType,
    title: `${input.analysisType} extraction — ${document.name}`,
    summary: validated.summary,
    results: validated.items,
  });
  await db.insert(activitiesTable).values({
    workspaceId: workspace.id,
    userId,
    type: "extraction",
    title: `Extracted ${input.analysisType} from ${document.name}`,
  });
  res.json(validated);
});

export default router;