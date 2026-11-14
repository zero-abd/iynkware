import { LIMITS } from "../../core/limits.ts";
import { fail, ok } from "../../core/result.ts";
import type { Result } from "../../core/result.ts";
import { parseStrict } from "../../core/strict-json.ts";

export interface WokwiPart {
  id: string;
  type: string;
  left: number;
  top: number;
  rotate: number;
  attrs: Record<string, unknown>;
}

export interface WokwiWire {
  from: string;
  to: string;
  color: string;
}

export interface WokwiDiagram {
  parts: WokwiPart[];
  wires: WokwiWire[];
  /** Entries of `connections` that are not `[from, to, colour, ...]`, counted so the review can say so. */
  malformed: number;
}

export type DiagramErrorCode = "bad-json" | "not-a-diagram" | "too-many-parts";

export interface DiagramError {
  code: DiagramErrorCode;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const failure = (code: DiagramErrorCode, message: string) => fail<DiagramError>({ code, message });

/** Reads a Wokwi `diagram.json`: the parts with their position and attributes, and the connections as `part:pin` pairs. */
export function parseDiagram(text: string): Result<WokwiDiagram, DiagramError> {
  const parsed = parseStrict(text, { maxBytes: LIMITS.canonicalBytes, maxDepth: LIMITS.jsonDepth });
  if (!parsed.ok) return failure("bad-json", parsed.error.message);
  const root = parsed.value;
  if (!isRecord(root) || !Array.isArray(root.parts)) return failure("not-a-diagram", "diagram.json has no parts list");
  if (root.parts.length > LIMITS.components) return failure("too-many-parts", `${root.parts.length} parts; the limit is ${LIMITS.components}`);

  const parts: WokwiPart[] = [];
  const seen = new Set<string>();
  for (const raw of root.parts) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.type !== "string" || seen.has(raw.id)) {
      return failure("not-a-diagram", "a part has no id or type, or its id is used twice");
    }
    seen.add(raw.id);
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    parts.push({ id: raw.id, type: raw.type, left: num(raw.left), top: num(raw.top), rotate: num(raw.rotate), attrs: isRecord(raw.attrs) ? raw.attrs : {} });
  }

  const wires: WokwiWire[] = [];
  let malformed = 0;
  for (const raw of Array.isArray(root.connections) ? root.connections : []) {
    if (Array.isArray(raw) && typeof raw[0] === "string" && typeof raw[1] === "string") {
      wires.push({ from: raw[0], to: raw[1], color: typeof raw[2] === "string" ? raw[2] : "" });
    } else {
      malformed++;
    }
  }
  return ok({ parts, wires, malformed });
}

/** `uno:13` is part `uno`, pin `13`. The first colon splits; Wokwi pin names carry none. */
export function splitEndpoint(endpoint: string): { part: string; pin: string } | null {
  const at = endpoint.indexOf(":");
  return at <= 0 || at === endpoint.length - 1 ? null : { part: endpoint.slice(0, at), pin: endpoint.slice(at + 1) };
}
