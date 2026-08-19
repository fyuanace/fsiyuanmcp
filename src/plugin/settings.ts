import { z } from "zod";
import type { NotebookInfo } from "../siyuan/contracts.js";

export const settingsSchema = z.object({
  mcpUrl: z.string().url().default("http://127.0.0.1:3900/mcp"),
  writableNotebookId: z.string().min(1),
  showTopbarStatus: z.boolean().default(true),
  autoStartOnBoot: z.boolean().default(true),
  autoStartDelayMs: z.number().int().min(1000).max(2000).default(1500)
});

export type PluginSettings = z.infer<typeof settingsSchema>;

export function validateSettings(input: unknown): PluginSettings {
  return settingsSchema.parse(input);
}

export function ensureNotebookSelectable(
  notebookId: string,
  notebooks: NotebookInfo[]
): void {
  const found = notebooks.some((notebook) => notebook.id === notebookId);
  if (!found) {
    throw new Error("目标可写笔记本不存在，请重新选择");
  }
}
