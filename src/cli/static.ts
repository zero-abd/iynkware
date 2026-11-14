import { createInlinePort } from "@/protocol";
import { createSimHandler } from "@/sim-host/handler";
import { createSimHost } from "@/sim-host/host";
import { buildSimNetlist } from "@/sim/netlist";
import { getAppRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { createDigitalNets } from "@/sim/digital/nets";
import { defaultRules } from "@/sim/faults/rules";
import type { Finding } from "@/sim/faults/types";

export interface StaticResult {
  findings: Finding[];
  /** Rules that threw; the others still ran. */
  ruleErrors: { ruleId: string; message: string }[];
}

export interface StaticChecker {
  check(project: Project): Promise<StaticResult>;
  close(): Promise<void>;
}

/** The page's own circuit check: the same host and handler that answer the Studio's `static-check`, over an inline port. */
export function createStaticChecker(): StaticChecker {
  const parts = getAppRegistry();
  const host = createSimHost({
    makePort: () =>
      createInlinePort(
        createSimHandler({
          diag: false,
          wallMs: () => performance.now(),
          schedule: (fn) => void setTimeout(fn, 0),
          makeEngine: () => {
            throw new Error("a static check loads no program");
          },
          makeDigital: createDigitalNets,
          faults: {
            describe(id) {
              const [ref = "", version = ""] = id.split("@");
              return parts.get(ref, version);
            },
            rules: defaultRules,
          },
        }),
      ),
  });
  return {
    async check(project) {
      const { net } = buildSimNetlist(project, parts);
      const sources = Object.fromEntries(project.sources.map((s) => [s.path, s.content]));
      const reply = await host.staticCheck(net, sources);
      return { findings: reply.findings, ruleErrors: reply.errors };
    },
    close: () => host.kill(),
  };
}
