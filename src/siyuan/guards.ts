import type { GuardDecision, NotebookInfo } from "./contracts.js";

export function ensureWritableNotebook(
  writableNotebookId: string,
  targetNotebookId: string | undefined
): GuardDecision {
  if (!targetNotebookId) {
    return { allowed: false, reason: "Missing target notebook id" };
  }
  if (targetNotebookId !== writableNotebookId) {
    return {
      allowed: false,
      notebookId: targetNotebookId,
      reason: `Notebook ${targetNotebookId} is read-only in this MCP service`
    };
  }
  return { allowed: true, notebookId: targetNotebookId };
}

export function assertNotebookExists(notebooks: NotebookInfo[], notebookId: string): void {
  const exists = notebooks.some((item) => item.id === notebookId);
  if (!exists) {
    throw new Error(`Writable notebook ${notebookId} does not exist`);
  }
}
