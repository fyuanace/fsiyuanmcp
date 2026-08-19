import { MAX_HPATH_DEPTH } from "./format.js";

export type CategoryKind = "major" | "minor" | "content";

export type CategoryNode = {
  name: string;
  path: string;
  id?: string;
  kind: CategoryKind;
  children: CategoryNode[];
};

type DocRow = {
  id?: string;
  hpath?: string;
};

type MutableNode = {
  name: string;
  path: string;
  id?: string;
  children: Map<string, MutableNode>;
};

function kindForDepth(depth: number, hasChildren: boolean): CategoryKind {
  if (depth === 1) {
    return hasChildren ? "major" : "content";
  }
  if (depth === 2) {
    return hasChildren ? "minor" : "content";
  }
  return "content";
}

export function buildCategoryTree(rows: DocRow[]): CategoryNode[] {
  const root = new Map<string, MutableNode>();

  for (const row of rows) {
    const parts = String(row.hpath ?? "")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, MAX_HPATH_DEPTH);
    if (parts.length === 0) {
      continue;
    }
    let level = root;
    let acc = "";
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      acc += `/${name}`;
      let node = level.get(name);
      if (!node) {
        node = { name, path: acc, children: new Map() };
        level.set(name, node);
      }
      if (index === parts.length - 1 && row.id) {
        node.id = String(row.id);
      }
      level = node.children;
    }
  }

  const freeze = (map: Map<string, MutableNode>, depth: number): CategoryNode[] =>
    [...map.values()].map((node) => {
      const children = freeze(node.children, depth + 1);
      return {
        name: node.name,
        path: node.path,
        id: node.id,
        kind: kindForDepth(depth, children.length > 0),
        children
      };
    });

  return freeze(root, 1);
}
