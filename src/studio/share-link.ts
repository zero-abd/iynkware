import type { OpenShareResult } from "../collab/share-open.ts";
import type { PartRegistry } from "../parts/registry.ts";
import type { Project } from "../project/generated/types.ts";
import { stateHash } from "../project/hash.ts";
import { validateValue } from "../project/validate.ts";
import { decodeValue, encodeValue } from "./assignment/codec.ts";
import { compactProject, expandProject } from "./assignment/compact.ts";

/*
 * A share with no server: the project, compacted and gzipped, rides in the link's fragment, which the browser never
 * sends anywhere. Nobody stores it, so it can't expire or be stopped, and it opens read-only like a server share.
 */

const FRAGMENT = /^#project=([A-Za-z0-9_-]+)$/;

/** The longest code a project link carries; chat apps and browsers take this much in an address. */
export const PROJECT_LINK_LIMIT = 32_768;

type Parts = Pick<PartRegistry, "get">;

export type ProjectLink = { ok: true; link: string } | { ok: false; reason: "tooLarge" | "hasFiles" };

export function parseProjectFragment(hash: string): string | null {
  return FRAGMENT.exec(hash)?.[1] ?? null;
}

/** The link that carries `doc`. A project with attached files can't travel this way: the link holds no file bodies. */
export async function projectLink(doc: Project, parts: Parts, at: { origin: string; lang: string }): Promise<ProjectLink> {
  if (doc.assets.length > 0) return { ok: false, reason: "hasFiles" };
  const code = await encodeValue(compactProject(doc, parts));
  if (code.length > PROJECT_LINK_LIMIT) return { ok: false, reason: "tooLarge" };
  return { ok: true, link: `${at.origin}/${at.lang}/studio#project=${code}` };
}

/** The project in a link's code, checked like a server share, ready for the read-only view. */
export async function openProjectLink(code: string, parts: Parts): Promise<OpenShareResult> {
  if (code.length > PROJECT_LINK_LIMIT) return { ok: false, reason: "invalid" };
  const value = await decodeValue(code);
  if (!value.ok) return { ok: false, reason: "invalid" };
  let report: ReturnType<typeof validateValue>;
  try {
    report = validateValue(expandProject(value.value as Project, parts));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!report.ok || !report.doc) return { ok: false, reason: "invalid" };
  const doc = report.doc;
  return {
    ok: true,
    opened: {
      doc,
      share: { id: "link", allowFork: true, revision: doc.revision, expiresAt: null },
      owner: { displayName: "" },
      stateHash: stateHash(doc),
      assets: new Map(),
    },
  };
}
