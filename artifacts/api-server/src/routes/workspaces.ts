import {
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  GetDashboardQueryParams,
  GetDashboardResponse,
  ListWorkspacesResponse,
} from "@workspace/api-zod";
import {
  activitiesTable,
  analysesTable,
  db,
  documentsTable,
  workspacesTable,
} from "@workspace/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { authenticatedUserId } from "../middlewares/requireAuth";
import { serializeDocument, serializeWorkspace } from "../lib/serializers";

const router: IRouter = Router();

router.get("/workspaces", async (_req: Request, res: Response) => {
  const userId = authenticatedUserId(res);

  let rows = await db
    .select({
      workspace: workspacesTable,
      documentCount: count(documentsTable.id),
    })
    .from(workspacesTable)
    .leftJoin(documentsTable, eq(documentsTable.workspaceId, workspacesTable.id))
    .where(eq(workspacesTable.userId, userId))
    .groupBy(workspacesTable.id)
    .orderBy(asc(workspacesTable.createdAt));

  if (rows.length === 0) {
    await db
      .insert(workspacesTable)
      .values({ userId, name: "My workspace" })
      .onConflictDoNothing();
    rows = await db
      .select({
        workspace: workspacesTable,
        documentCount: count(documentsTable.id),
      })
      .from(workspacesTable)
      .leftJoin(documentsTable, eq(documentsTable.workspaceId, workspacesTable.id))
      .where(eq(workspacesTable.userId, userId))
      .groupBy(workspacesTable.id)
      .orderBy(asc(workspacesTable.createdAt));
  }

  res.json(
    ListWorkspacesResponse.parse(
      rows.map(({ workspace, documentCount }) =>
        serializeWorkspace(workspace, documentCount),
      ),
    ),
  );
});

router.post("/workspaces", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "Enter a workspace name." });
    return;
  }

  try {
    const [workspace] = await db
      .insert(workspacesTable)
      .values({ userId, name: parsed.data.name.trim() })
      .returning();
    res.status(201).json(
      CreateWorkspaceResponse.parse(serializeWorkspace(workspace, 0)),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(400).json({ error: "A workspace with that name already exists." });
      return;
    }
    throw error;
  }
});

router.get("/dashboard", async (req: Request, res: Response) => {
  const userId = authenticatedUserId(res);
  const parsed = GetDashboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a workspace." });
    return;
  }

  const [workspace] = await db
    .select()
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

  const [documentRows, recentDocuments, activities, analysisCounts, deadlineRows] =
    await Promise.all([
      db
        .select({
          status: documentsTable.status,
          total: count(),
        })
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.workspaceId, workspace.id),
            eq(documentsTable.ownerId, userId),
          ),
        )
        .groupBy(documentsTable.status),
      db
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.workspaceId, workspace.id),
            eq(documentsTable.ownerId, userId),
          ),
        )
        .orderBy(desc(documentsTable.updatedAt))
        .limit(5),
      db
        .select()
        .from(activitiesTable)
        .where(
          and(
            eq(activitiesTable.workspaceId, workspace.id),
            eq(activitiesTable.userId, userId),
          ),
        )
        .orderBy(desc(activitiesTable.createdAt))
        .limit(8),
      db
        .select({ total: count() })
        .from(analysesTable)
        .where(
          and(
            eq(analysesTable.workspaceId, workspace.id),
            eq(analysesTable.ownerId, userId),
            inArray(analysesTable.analysisType, ["clauses", "financial", "comparison"]),
            gte(
              analysesTable.createdAt,
              new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            ),
          ),
        ),
      db
        .select({
          analysis: analysesTable,
          documentName: documentsTable.name,
        })
        .from(analysesTable)
        .leftJoin(documentsTable, eq(analysesTable.documentId, documentsTable.id))
        .where(
          and(
            eq(analysesTable.workspaceId, workspace.id),
            eq(analysesTable.ownerId, userId),
            eq(analysesTable.analysisType, "deadlines"),
          ),
        )
        .orderBy(desc(analysesTable.createdAt))
        .limit(50),
    ]);

  const counts = new Map(documentRows.map((row) => [row.status, row.total]));
  const totalDocuments = documentRows.reduce((sum, row) => sum + row.total, 0);
  const today = new Date().toISOString().slice(0, 10);
  const upcomingDeadlines = deadlineRows.flatMap(({ analysis, documentName }) =>
    analysis.results.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      if (
        !analysis.documentId ||
        typeof item.date !== "string" ||
        item.date < today ||
        typeof item.value !== "string" ||
        !documentName
      ) {
        return [];
      }
      const riskLevel =
        item.riskLevel === "low" || item.riskLevel === "high"
          ? item.riskLevel
          : "medium";
      return [
        {
          documentId: analysis.documentId,
          documentName,
          date: item.date,
          description:
            typeof item.label === "string"
              ? `${item.label}: ${item.value}`
              : item.value,
          riskLevel,
        },
      ];
    }),
  );
  upcomingDeadlines.sort((a, b) => a.date.localeCompare(b.date));

  const workspaceDocumentCount = totalDocuments;
  const result = {
    workspace: serializeWorkspace(workspace, workspaceDocumentCount),
    metrics: {
      documentCount: totalDocuments,
      readyCount: counts.get("ready") ?? 0,
      indexingCount: counts.get("indexing") ?? 0,
      deadlineCount: upcomingDeadlines.length,
      reviewCount: analysisCounts[0]?.total ?? 0,
    },
    recentDocuments: recentDocuments.map(serializeDocument),
    upcomingDeadlines: upcomingDeadlines.slice(0, 8),
    recentActivity: activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      title: activity.title,
      createdAt: activity.createdAt.toISOString(),
    })),
  };

  res.json(GetDashboardResponse.parse(result));
});

export default router;