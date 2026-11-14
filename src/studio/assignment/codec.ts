import { fail, ok } from "../../core/result.ts";
import type { Failure, Result } from "../../core/result.ts";
import { parseStrict } from "../../core/strict-json.ts";
import { GZIP_MARK, InflateCapError, deflateText, inflateCapped } from "../../collab/gzip.ts";
import type { PartRegistry } from "../../parts/registry.ts";
import { checkAssignment } from "./assignment.ts";
import { compactProject, expandProject } from "./compact.ts";
import type { Project } from "../../project/generated/types.ts";
import type { AssignmentProject } from "./types.ts";

/** The longest code a link carries. A longer assignment goes by the server's share path, or as a file. */
export const LINK_LIMIT = 8192;

/** What a code may inflate to. A submission holds a whole project. */
export const INFLATED_CAP = 4 * 1024 * 1024;

const FRAGMENT = /^#assignment=([A-Za-z0-9_-]+)$/;
const CODE = /^[A-Za-z0-9_-]+$/;
const CHUNK = 0x8000;

const bad = (code: string, message: string): Result<never, Failure> => fail({ code, message });

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!CODE.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A value as the text of a link or a pasted code: its JSON, gzipped, in base64url. */
export async function encodeValue(value: unknown): Promise<string> {
  return toBase64Url(await deflateText(JSON.stringify(value)));
}

export async function decodeValue(code: string): Promise<Result<unknown, Failure>> {
  const bytes = fromBase64Url(code.trim());
  if (!bytes || bytes[0] !== GZIP_MARK) return bad("not-a-code", "this is not a code from iynk");
  let text: string;
  try {
    text = await inflateCapped(bytes.subarray(1), INFLATED_CAP);
  } catch (e) {
    return e instanceof InflateCapError ? bad("too-large", "the code is larger than it may be") : bad("not-a-code", "this is not a code from iynk");
  }
  return parseStrict(text, { maxBytes: INFLATED_CAP });
}

export const assignmentLink = (lang: string, origin: string, code: string): string => `${origin}/${lang}/studio#assignment=${code}`;

/** The code in an address fragment, or null when the fragment is not an assignment's. */
export function parseAssignmentFragment(hash: string): string | null {
  return FRAGMENT.exec(hash)?.[1] ?? null;
}

/** The code in a pasted link or in the code itself. */
export function codeOf(pasted: string): string | null {
  const text = pasted.trim();
  const hash = text.includes("#") ? text.slice(text.indexOf("#")) : "";
  return parseAssignmentFragment(hash) ?? (CODE.test(text) ? text : null);
}

/** The code of an assignment: the project in its compact form, so a small circuit fits in a link. */
export const encodeAssignment = (assignment: AssignmentProject, parts: Pick<PartRegistry, "get">): Promise<string> => encodeValue(compactProject(assignment, parts));

/** The assignment in a code, once it is a valid project that holds a valid assignment. */
export async function decodeAssignment(code: string, parts: Pick<PartRegistry, "get">): Promise<Result<AssignmentProject, Failure>> {
  const value = await decodeValue(code);
  if (!value.ok) return value;
  try {
    return checkAssignment(expandProject(value.value as Project, parts));
  } catch {
    return bad("not-an-assignment", "the code holds no assignment");
  }
}
