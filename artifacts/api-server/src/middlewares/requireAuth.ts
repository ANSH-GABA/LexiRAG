import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to access this workspace." });
    return;
  }
  res.locals.userId = userId;
  next();
}

export function authenticatedUserId(res: Response): string {
  const userId = res.locals.userId;
  if (typeof userId !== "string" || !userId) {
    throw new Error("Authenticated user context is missing.");
  }
  return userId;
}