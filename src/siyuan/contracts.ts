export type SiYuanApiResponse<T> = {
  code: number;
  msg: string;
  data: T;
};

export type NotebookInfo = {
  id: string;
  name: string;
  icon?: string;
  closed?: boolean;
};

export type LsNotebooksData = {
  notebooks: NotebookInfo[];
};

export type SearchDocsItem = {
  box: string;
  path: string;
  hPath: string;
  boxIcon?: string;
};

export type FullTextBlockItem = {
  id: string;
  box: string;
  path: string;
  hPath: string;
  type: string;
  content: string;
  updated?: string;
};

export type FullTextSearchData = {
  blocks: FullTextBlockItem[];
  matchedBlockCount: number;
  pageCount: number;
};

export type CreateDocResult = {
  id: string;
};

export type StandardResult = {
  id?: string;
  doOperations?: unknown[];
};

export type GuardDecision = {
  allowed: boolean;
  notebookId?: string;
  reason?: string;
};

export class SiYuanApiError extends Error {
  public readonly endpoint: string;
  public readonly code?: number;
  public readonly detail?: string;

  public constructor(endpoint: string, message: string, code?: number, detail?: string) {
    super(message);
    this.name = "SiYuanApiError";
    this.endpoint = endpoint;
    this.code = code;
    this.detail = detail;
  }
}
