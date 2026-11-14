/** `.iynk` / `.iynkz` files and `#project=` links, over iynk's own writers, readers and link codec (imported unchanged). */
import { builtinRegistry } from '@/parts/builtin';
import { readIynk, writeIynk } from '@/export/iynk';
import { readIynkz, type ContainerAsset } from '@/export/iynkz';
import { openProjectLink, parseProjectFragment, projectLink } from '@/studio/share-link';
import type { Project } from '../../contracts/project';
import type { LinkResult } from './types';

export class ImportFailed extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportFailed';
  }
}

const HASH_KEY = '#project=';

/** The code in a fragment (`#project=<code>`), a whole link in this app's form or the 2D Studio's (`/<lang>/studio#project=<code>`), or a bare code. */
export function codeOf(text: string): string | null {
  const at = text.indexOf(HASH_KEY);
  if (at >= 0) return parseProjectFragment(text.slice(at));
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : null;
}

/** `.iynk` bytes of a document. */
export const iynkBytes = (doc: Project): Uint8Array => writeIynk(doc);

/** Reads `.iynk` or `.iynkz` bytes (a zip starts with `PK`), validating and migrating. Throws `ImportFailed`. */
export async function readProjectFile(bytes: Uint8Array, clock: () => number): Promise<{ project: Project; assets: readonly ContainerAsset[] }> {
  // `readIynkz` opens a container; a plain `.iynk` is JSON, so route by the zip signature and let both readers validate.
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const report = await readIynkz(bytes, clock);
    if (!report.ok) throw new ImportFailed(report.error.kind, report.error.message);
    return { project: report.project, assets: report.assets ?? [] };
  }
  const report = readIynk(bytes, clock);
  if (!report.ok) throw new ImportFailed(report.error.kind, report.error.message);
  return { project: report.project, assets: [] };
}

/** The share link for a document, in this app's address: `<origin><path>#project=<code>`. */
export async function linkFor(doc: Project, at: { origin: string; pathname: string }, lang: string): Promise<LinkResult> {
  try {
    const made = await projectLink(doc, builtinRegistry(), { origin: at.origin, lang });
    if (!made.ok) return made;
    const code = codeOf(made.link);
    return code === null ? { ok: false, reason: 'failed' } : { ok: true, link: `${at.origin}${at.pathname}${HASH_KEY}${code}` };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** The document in a link's code, checked like a server share. Throws `ImportFailed` for a bad code. */
export async function docFromLink(code: string): Promise<Project> {
  const opened = await openProjectLink(code, builtinRegistry());
  if (!opened.ok) throw new ImportFailed('bad-link', 'the link does not hold a project');
  return opened.opened.doc;
}

/** The file name a project downloads as. */
export const fileNameOf = (title: string): string => `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'project'}.iynk`;

/** Downloads bytes through a temporary anchor; call it from a user gesture. */
export function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
