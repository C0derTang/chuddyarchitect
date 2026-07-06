import { NextRequest } from "next/server";

// Worker API routes are gated by a shared bearer token. If WORKER_TOKEN is
// unset (local dev), all requests are allowed.
export function checkWorkerAuth(req: NextRequest): boolean {
  const token = process.env.WORKER_TOKEN;
  if (!token) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}
