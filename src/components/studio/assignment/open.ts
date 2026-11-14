import { cryptoRandom, newProjectId } from "@/core/ids";
import { writeIynk } from "@/export/iynk";
import { getAppRegistry } from "@/parts/builtin";
import { startAssignment } from "@/studio/assignment/assignment";
import { decodeAssignment } from "@/studio/assignment/codec";
import { ASSIGNMENT_EXT } from "@/studio/assignment/types";
import { LOCAL_ACTOR } from "@/studio/templates";
import type { Services } from "../wiring/services";
import { rememberStarted, startedProject } from "./memory";

/**
 * The student's project for the assignment in a link: the one made the last time this device opened it, if it is still
 * there, and otherwise a new copy of the starter. Rejects when the link holds no assignment.
 */
export async function openAssignmentLink(code: string, { files, library }: Pick<Services, "files" | "library">): Promise<string> {
  const decoded = await decodeAssignment(code, getAppRegistry());
  if (!decoded.ok) throw new Error(decoded.error.message);
  const { id } = decoded.value.ext[ASSIGNMENT_EXT];
  const earlier = startedProject(id);
  if (earlier !== null && (await library.list()).some((row) => row.id === earlier)) return earlier;
  const mine = startAssignment(decoded.value, { id: newProjectId(Date.now(), cryptoRandom), now: new Date().toISOString(), actor: LOCAL_ACTOR });
  const outcome = await files.importBytes(writeIynk(mine), `${mine.meta.title}.iynk`);
  if (!outcome.ok) throw new Error(outcome.error.message);
  rememberStarted(id, outcome.id);
  return outcome.id;
}
