// Types for client-core.mjs, for the headset app (xr/src/agent/voice).
export const CONTEXT_LIMIT: number;
export function untrustedContext(value: unknown): string;
export function rawSetup(model: string, config: Readonly<Record<string, unknown>>): Record<string, unknown>;
export function controllerTalkPressed(root: unknown): boolean;
