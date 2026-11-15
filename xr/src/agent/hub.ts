/**
 * The agent's shared state per world, made by whichever sub-module mounts first: the conversation and callouts the
 * bubbles draw, the coach, the tools and the bridge. `XrApp` has no agent service (a contract change would add one),
 * so the sub-modules and scripts find it here (`agentOf(world)`) or on `window.iynkware.agent` (the bridge).
 */
import { createCalloutList, createConversation, type CalloutList, type Conversation } from './bubbles/model';
import { createCoach, type Coach } from './coach/coach';
import type { AgentBridge } from './bridge/bridge';
import type { AgentTool, ToolHost } from './tools/catalog';

export interface AgentHub {
  readonly conversation: Conversation;
  readonly callouts: CalloutList;
  readonly coach: Coach;
  readonly now: () => number;
  tools: AgentTool[] | null;
  host: ToolHost | null;
  bridge: AgentBridge | null;
  /** The microphone level while the person talks (voice), else null. */
  micLevel: (() => number | null) | null;
}

const hubs = new WeakMap<object, AgentHub>();
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function agentOf(world: object): AgentHub {
  let h = hubs.get(world);
  if (!h) {
    h = { conversation: createConversation(), callouts: createCalloutList(clock), coach: createCoach(clock), now: clock, tools: null, host: null, bridge: null, micLevel: null };
    hubs.set(world, h);
  }
  return h;
}

export const dropAgent = (world: object): void => void hubs.delete(world);

/** Attaches `value` as `window.iynkware[key]` once main.ts has made `window.iynkware` (after every module mounted). */
export function attachToWindow(key: string, value: unknown): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attach = () => {
    const w = (globalThis as { iynkware?: Record<string, unknown> }).iynkware;
    if (w) w[key] = value;
    else timer = setTimeout(attach, 100);
  };
  if (typeof window !== 'undefined') attach();
  return () => {
    if (timer) clearTimeout(timer);
    const w = (globalThis as { iynkware?: Record<string, unknown> }).iynkware;
    if (w && w[key] === value) delete w[key];
  };
}
