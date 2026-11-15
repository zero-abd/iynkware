/**
 * The scripted brain: no model, no network. Keyword intents in English and German for the demo questions, each done
 * through the tools (so it says only what a tool result backs): it changes the circuit (remove, pull out, turn a part),
 * takes changes back (undo, redo), says what is wrong (explain_problems) and fixes it (apply_fix); and a callout with the fix when the coach reports a
 * lab mistake or a bench finding. Anything else gets an honest "I can only answer a few things" with suggestion chips.
 */
import { LAB_NAMES } from '../../lab/model/catalogue';
import type { LabId } from '../../lab/model/types';
import { fill, say as sayL6, type L6 } from '../../lab/text';
import { AGENT_TEXT } from '../text';
import type { StepTarget } from '../tools/steps';
import type { Brain, BrainIO } from './bridge';

export type Intent =
  | { readonly kind: 'undo' | 'redo' | 'yes' | 'all' | 'no' | 'next' | 'wrong' | 'fix' }
  | { readonly kind: 'edit'; readonly action: 'removePart' | 'pullPart' | 'turnPart'; readonly thing: string; readonly half?: boolean }
  | { readonly kind: 'sim'; readonly action: 'run' | 'pause' | 'stop' }
  | { readonly kind: 'go'; readonly where: string }
  | { readonly kind: 'give'; readonly name: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'add'; readonly name: string }
  | { readonly kind: 'find'; readonly name: string }
  | { readonly kind: 'mode'; readonly mode: 'build' | 'assist' }
  | { readonly kind: 'goto'; readonly target: StepTarget }
  | { readonly kind: 'stopSteps' }
  | { readonly kind: 'where'; readonly thing: string }
  | { readonly kind: 'build'; readonly request: string }
  | { readonly kind: 'open'; readonly lab: LabId }
  | { readonly kind: 'start'; readonly id: string; readonly mode: 'practice' | 'exam' }
  | { readonly kind: 'unknown' };

const LABS: ReadonlyArray<readonly [RegExp, LabId]> = [
  [/chem/, 'chemistry'],
  [/physi/, 'physics'],
  [/electr|elektr/, 'electrical'],
  [/signal/, 'signals'],
];
const EXPERIMENT_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/flame|flammen/, 'chemistry/flame-test'],
  [/\bph\b/, 'chemistry/ph'],
  [/ohm/, 'electrical/ohms-law'],
  [/pendul|pendel/, 'physics/pendulum'],
  [/wave|welle/, 'signals/measure-wave'],
];
/** German nouns to the English the tools resolve. */
const NOUNS: Readonly<Record<string, string>> = { widerstand: 'resistor', brenner: 'burner', steckbrett: 'breadboard', becherglas: 'beaker', kolben: 'flask' };
/** A count in words or digits, English or German, one to twenty; null when it is not one. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eins: 1, ein: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
};
const countOf = (w: string | undefined): number | null => {
  if (!w) return null;
  const n = /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w];
  return n !== undefined && n >= 1 && n <= 20 ? n : null;
};
const N = '(\\d+|[a-zäöü]+)';

/** A request to move a step-by-step build several steps at once, or to stop one; null when the sentence is not one. */
function stepIntent(t: string): Intent | null {
  if (/^(?:stop|pause|halt) (?:the )?(?:build|building|steps?)\b|^(?:wait|hold on)\b|^(?:stopp|warte)\b/.test(t)) return { kind: 'stopSteps' };
  if (/back to (?:the )?(?:start|beginning)|start over|from the (?:start|beginning)|reset the build|zurück zum (?:anfang|start)|von vorne/.test(t)) return { kind: 'goto', target: { to: 'start' } };
  const to = new RegExp(`\\bto step ${N}\\b|\\bzu schritt ${N}\\b`).exec(t);
  const toN = countOf(to?.[1] ?? to?.[2]);
  if (toN) return { kind: 'goto', target: { step: toN } };
  const back = new RegExp(`\\bback ${N} steps?\\b|${N} schritte? zurück`).exec(t);
  const backN = countOf(back?.[1] ?? back?.[2]);
  if (backN) return { kind: 'goto', target: { by: -backN } };
  const fwd = new RegExp(`\\bnext ${N} steps\\b|\\b(?:forward|ahead) ${N} steps?\\b|\\bdo ${N} (?:more )?steps\\b|nächsten ${N} schritte`).exec(t);
  const fwdN = countOf(fwd?.[1] ?? fwd?.[2] ?? fwd?.[3] ?? fwd?.[4]);
  if (fwdN) return { kind: 'goto', target: { by: fwdN } };
  if (/^(?:go |step )?back(?: one step| a step)?$|^einen schritt zurück$/.test(t)) return { kind: 'goto', target: { by: -1 } };
  if (/\b(?:do|run|go through|accept) (?:all|every)(?: of)?(?: the)? steps?\b|\bdo (?:it )?all\b|do everything|finish (?:it|the build|building)|build the rest|run through|do the rest|accept all|alle schritte|mach alles|mach den rest|alle annehmen/.test(t)) {
    return { kind: 'goto', target: { to: 'end' } };
  }
  return null;
}

const WHERE = /^(?:where(?:'s| is| are)|show me|which is|find|wo (?:ist|sind)|zeig mir|finde)\s+/;
const ARTICLE = /^(?:the|a|an|der|die|das|den|dem|ein|eine)\s+/;

/** What a sentence asks, in English or German. */
export function intentOf(raw: string): Intent {
  const t = raw.toLowerCase().replace(/[?!.¿¡,]/g, ' ').replace(/\s+/g, ' ').trim();
  const short = t.split(' ').length <= 4;
  if (/\bredo\b|put (?:that|it) back|wiederherstellen/.test(t)) return { kind: 'redo' };
  if (/\bundo\b|take (?:that|it) back|rückgängig/.test(t)) return { kind: 'undo' };
  if (/what(?:'s| is) wrong|why (?:does|doesn't|won't|isn't|is it not|is)|not working|doesn't work|check (?:the |my )?circuit|explain|problem|was ist falsch|warum|funktioniert nicht|prüfe/.test(t)) return { kind: 'wrong' };
  if (/^(?:fix|repair|repariere|reparier)\b|\bfix (?:it|that|this|them|everything|all)\b/.test(t)) return { kind: 'fix' };
  const steps = stepIntent(t);
  if (steps) return steps;
  if (/^(?:run|start)(?: the)? (?:circuit|sim|simulation|it)\b|^starte die schaltung/.test(t)) return { kind: 'sim', action: 'run' };
  if (/^(?:stop|halt)(?: the)? (?:circuit|sim|simulation|it|run)?\b|^stopp/.test(t)) return { kind: 'sim', action: 'stop' };
  if (/^pause\b/.test(t)) return { kind: 'sim', action: 'pause' };
  const edit = /^(remove|delete|take out|entferne|lösche|pull out|unplug|zieh|turn around|flip|reverse|rotate|turn|dreh(?:e)?)\s+(.+?)(?:\s+(around|herum|um))?$/.exec(t);
  if (edit) {
    const verb = edit[1]!;
    const thing = edit[2]!.replace(ARTICLE, '').trim();
    const named = NOUNS[thing] ?? thing;
    if (/remove|delete|take out|entferne|lösche/.test(verb)) return { kind: 'edit', action: 'removePart', thing: named };
    if (/pull|unplug|zieh/.test(verb)) return { kind: 'edit', action: 'pullPart', thing: named };
    return { kind: 'edit', action: 'turnPart', thing: named, half: /around|flip|reverse|herum|um/.test(t) || !!edit[3] };
  }
  if (short && /^(?:yes|yeah|yep|accept|do it|ok|okay|sure|ja|annehmen|mach es|mach das)\b/.test(t)) return { kind: 'yes' };
  if (short && /^(?:no|nope|skip|nein|überspring)/.test(t)) return { kind: 'no' };
  if (/\b(?:start|begin|run|starte|beginne|mach)\b/.test(t)) {
    const exp = EXPERIMENT_WORDS.find(([re]) => re.test(t));
    if (exp) return { kind: 'start', id: exp[1], mode: /exam|prüfung/.test(t) ? 'exam' : 'practice' };
  }
  if (/(?:^|\s)(?:open|öffne|go to|geh ins)(?:\s|$)/.test(t)) {
    const lab = LABS.find(([re]) => re.test(t));
    if (lab) return { kind: 'open', lab: lab[1] };
  }
  // the person's own build: an empty workbench, parts from the library by name
  if (/\b(?:empty|blank|clear|clean|fresh)\b.*\b(?:bench|workbench|board|project|one)\b|\b(?:new|own) project\b|\b(?:bench|workbench|project)\b.*\b(?:empty|blank)\b|\bfrom scratch\b|\bmy own (?:thing|circuit|build|project)\b|neues projekt|leere werkbank|von null/.test(t)) return { kind: 'empty' };
  const find = /^(?:is there|do (?:you|we) have|have you got|does the (?:parts )?library have|gibt es|habt ihr|hast du)\s+(?:an?\s+|any\s+|some\s+|eine?n?\s+)?(.+?)(?:\s+(?:in|on) (?:the|your) (?:parts )?(?:library|shelf))?$/.exec(t);
  if (find) return { kind: 'find', name: find[1]! };
  const add = /^(?:add|put|place|füge|leg|stell)\s+(?:an?\s+|one\s+|the\s+|another\s+|eine?n?\s+)?(.+?)(?:\s+(?:on|to|onto|in|auf)\s+(?:the\s+|die\s+)?(?:work)?(?:bench|werkbank)|\s+hinzu)?$/.exec(t);
  if (add) return { kind: 'add', name: add[1]! };
  const give = /^(?:give me|get me|bring me|hand me|i need|i want|can i have|gib mir|ich brauche)\s+(?:some\s+|a\s+|an\s+|the\s+|etwas\s+)?(.+)$/.exec(t);
  if (give) return { kind: 'give', name: give[1]! };
  const mode = /\b(build|assist(?:ant|ance)?|bau|hilfe)[- ]?(?:mode|modus)\b/.exec(t);
  if (mode) return { kind: 'mode', mode: /^(build|bau)/.test(mode[1]!) ? 'build' : 'assist' };
  // the drone's two places, before the circuit's build: its workbench ("build the drone") or the Range ("fly the drone")
  // "build the drone with me" / "step by step": the co-builder (propose_build fits the drone's parts one at a time)
  if (/\b(?:drone|quad)\b|drohne/.test(t) && /with me|for me|step by step|mit mir|schritt für schritt/.test(t)) return { kind: 'build', request: t };
  if (/\b(?:drone|quad)\b|drohne/.test(t) && /\b(?:build|assemble|put (?:it )?together|fly|calibrate)\b|test the motors|bauen|fliegen/.test(t)) return { kind: 'go', where: t };
  const go = /^(?:go (?:back )?to|switch to|take me to|bring me to|open|show me|(?:let'?s )?work on|geh(?: zu| zum| zur| ins)?|wechsle zu|öffne)\s+(.+)$/.exec(t);
  if (go && !/\bbuild\b/.test(t)) return { kind: 'go', where: /^(?:let'?s )?work on/.test(t) ? `work on ${go[1]!}` : go[1]! };
  if (/\bbuild\b|\bbau(?:e|en)?\b|aufbauen/.test(t)) return { kind: 'build', request: /with me|mit mir/.test(t) && !/blink/.test(t) ? 'build it with me' : t };
  if (/what (?:should i do )?next|next step|what now|what do i do|als nächstes|nächster schritt|was jetzt|was soll ich/.test(t)) return { kind: 'next' };
  const w = WHERE.exec(t);
  if (w) {
    const thing = t.slice(w[0].length).replace(ARTICLE, '').trim();
    if (thing) return { kind: 'where', thing: NOUNS[thing] ?? thing };
  }
  return { kind: 'unknown' };
}

/** What Assist mode still answers: reading, pointing, explaining and the mode switch itself. */
const ASSIST_OK: ReadonlySet<Intent['kind']> = new Set(['next', 'where', 'wrong', 'unknown', 'mode', 'find']);

const QUESTIONS = (io: BrainIO) => AGENT_TEXT.questions.map((q) => sayL6(q, io.lang()));

export function scriptedBrain(): Brain {
  const t = (io: BrainIO, s: L6, vars?: Parameters<typeof fill>[1]) => sayL6(vars ? fill(s, vars) : s, io.lang());
  const R = AGENT_TEXT.reply;
  return {
    name: 'scripted',
    async turn({ text }, io) {
      const intent = intentOf(text);
      const done = (s: string, suggestions?: readonly string[]) => io.say(s, { final: true, suggestions });
      if (intent.kind === 'mode') {
        const r = await io.call('set_mode', { mode: intent.mode });
        return done(r.ok ? t(io, intent.mode === 'build' ? R.modeBuild : R.modeAssist) : t(io, R.cannotChange, { why: String(r.error) }));
      }
      // Assist mode takes no action but switching to build: say so in one line and offer help instead.
      if (!ASSIST_OK.has(intent.kind) && (await io.call('look')).companion === 'assist') return done(t(io, R.assistNo), [t(io, R.buildModeChip)]);
      switch (intent.kind) {
        case 'next': {
          const r = await io.call('next_step_hint');
          if (r.ok) return done(t(io, R.next, { step: String(r.text) }));
          if (/exam/.test(r.error ?? '')) return done(t(io, R.examNoHints));
          return done(t(io, R.nothingNext), QUESTIONS(io).slice(3, 6));
        }
        case 'where': {
          const r = await io.call('point_at', { target: intent.thing, text: t(io, R.useThis), tone: 'do' });
          return done(r.ok ? t(io, R.here) : t(io, R.notHere));
        }
        case 'build': {
          const r = await io.call('propose_build', { request: intent.request });
          const step = r.step as { label?: string } | null | undefined;
          if (r.ok && step?.label) return done(t(io, R.proposed, { label: step.label }));
          return done(t(io, R.freeBuild));
        }
        case 'empty': {
          const r = await io.call('go_to', { where: 'new project' });
          return done(r.ok ? t(io, R.emptyBench) : t(io, R.cannotGo, { where: 'new project' }));
        }
        case 'find': {
          const r = await io.call('find_parts', { query: intent.name });
          const parts = ((r.parts ?? []) as Array<{ name: string }>).slice(0, 3).map((p) => p.name);
          return done(r.ok && parts.length > 0 ? t(io, R.inLibrary, { parts: parts.join(', ') }) : t(io, R.notInLibrary, { name: intent.name }));
        }
        case 'add': {
          const r = await io.call('add_part', { name: intent.name });
          if (r.ok) return done(t(io, R.added, { part: String(r.part) }));
          return done(r.inLibrary === false ? t(io, R.notInLibrary, { name: intent.name }) : t(io, R.cannotChange, { why: String(r.say ?? r.error) }));
        }
        case 'give': {
          const r = await io.call('give_substance', { name: intent.name });
          if (!r.ok) return done(t(io, R.noStock, { name: intent.name }));
          return done(t(io, r.container === 'dish' ? R.gaveDish : r.container === 'jar' ? R.gaveJar : R.gaveBeaker, { name: String(r.formula ?? r.gave) }));
        }
        case 'go': {
          const r = await io.call('go_to', { where: intent.where });
          return done(r.ok ? t(io, R.went, { where: intent.where }) : t(io, R.cannotGo, { where: intent.where }));
        }
        case 'open': {
          const r = await io.call('open_lab', { lab: intent.lab });
          return done(r.ok ? t(io, R.opened, { lab: LAB_NAMES[intent.lab] }) : t(io, R.cannotBuild));
        }
        case 'start': {
          const r = await io.call('start_experiment', { id: intent.id, mode: intent.mode });
          const step = r.step as { text?: string } | null | undefined;
          return done(r.ok ? t(io, R.started, { step: step?.text ?? '' }) : t(io, R.nothingNext));
        }
        case 'yes':
        case 'all': {
          const r = await io.call('accept_step', intent.kind === 'all' ? { all: true } : {});
          const label = String(r.performed ?? r.first ?? '');
          return done(r.ok ? t(io, R.did, { label }) : t(io, R.nothingWaiting));
        }
        case 'goto': {
          const r = await io.call('go_to_step', intent.target);
          if (!r.ok) return done(t(io, R.nothingWaiting));
          if (!r.running) return done(t(io, R.alreadyThere));
          if (r.to === 'end') return done(t(io, R.goingEnd));
          if (r.to === 1) return done(t(io, R.goingStart));
          return done(t(io, R.goingTo, { step: String(r.to) }));
        }
        case 'stopSteps': {
          const r = await io.call('stop_steps');
          if (!r.ok) return done(t(io, R.nothingRunning));
          return done(r.done ? t(io, R.pausedDone) : t(io, R.pausedAt, { step: String(r.step) }));
        }
        case 'no': {
          const r = await io.call('reject_step');
          return done(r.ok ? t(io, R.skipped) : t(io, R.nothingWaiting));
        }
        case 'undo': {
          const r = await io.call('undo');
          return done(r.ok ? t(io, R.undone) : t(io, R.nothingUndo));
        }
        case 'redo': {
          const r = await io.call('redo');
          return done(r.ok ? t(io, R.redone) : t(io, R.nothingRedo));
        }
        case 'wrong': {
          const r = await io.call('explain_problems');
          if (!r.ok) return done(/exam/.test(r.error ?? '') ? t(io, R.examNoHints) : t(io, R.cannotChange, { why: String(r.error) }));
          const problems = (r.problems ?? []) as Array<{ title: string; why?: string | null; fix?: string | null; fixes?: Array<{ canApply: boolean }> }>;
          if (problems.length === 0) return done(t(io, R.problemsNone));
          const p = problems[0]!;
          const one = t(io, R.problemOne, { title: p.title, why: p.why ?? '', fix: p.fix ?? '' }).trim();
          const text = problems.length === 1 ? one : t(io, R.problemsMore, { count: problems.length, first: one });
          const fixable = p.fixes?.some((f) => f.canApply);
          return done(fixable ? `${text} ${t(io, R.canFix)}` : text, fixable ? [sayL6(AGENT_TEXT.questions[7]!, io.lang())] : undefined);
        }
        case 'fix': {
          const r = await io.call('apply_fix', {});
          if (!r.ok) return done(t(io, R.noFix));
          return done(t(io, R.fixed, { what: (r.applied as string[]).join(' ') }), [sayL6(AGENT_TEXT.questions[8]!, io.lang())]);
        }
        case 'edit': {
          // a turn: half way round for "turn it around" (one change), else a quarter turn either way that fits
          const tries = (part: string): object[] =>
            intent.action !== 'turnPart' ? [{ part }] : intent.half ? [{ part, deg: 180 }, { part, deg: 0 }] : [{ part, step: 1 }, { part, step: -1 }];
          const attempt = async (part: string) => {
            let last: Awaited<ReturnType<typeof io.call>> | null = null;
            for (const args of tries(part)) {
              last = await io.call('edit_bench', { action: intent.action, args_json: JSON.stringify(args) });
              if (last.ok) break;
            }
            return last!;
          };
          let r = await attempt(intent.thing);
          if (!r.ok && /unknown|no-such|bad-args|not-found|missing|no part/.test(`${String(r.reason ?? '')} ${String(r.error ?? '')}`)) {
            // an everyday word ("resistor", "led"): find the part by its kind and try again
            const where = await io.call('list_targets');
            const word = intent.thing.split(' ')[0]!.slice(0, 5);
            const hit = ((where.targets ?? []) as Array<{ id: string; def?: string }>).find((x) => (x.def ?? '').toLowerCase().includes(word) || x.id.toLowerCase().startsWith(word.slice(0, 3)));
            if (hit) r = await attempt(hit.id);
          }
          if (!r.ok) return done(t(io, R.cannotChange, { why: String(r.say ?? r.error) }));
          return done(t(io, R.changed, { what: String(r.did) }), [sayL6(AGENT_TEXT.questions[6]!, io.lang()), sayL6(AGENT_TEXT.questions[8]!, io.lang())]);
        }
        case 'sim': {
          const r = await io.call('run_circuit', { action: intent.action });
          if (!r.ok) return done(t(io, R.cannotChange, { why: String(r.error) }));
          return done(intent.action === 'run' ? t(io, R.running) : t(io, R.stopped));
        }
        default:
          return done(t(io, R.noModel), [QUESTIONS(io)[6]!, ...QUESTIONS(io).slice(0, 2)]);
      }
    },
    observe(o, io) {
      // Hazards are already shown by the coach itself; a plain mistake or a finding gets a callout with the fix.
      const ref = o.refs[0];
      if (!ref) return;
      if (o.kind === 'lab-mistake' && ref.startsWith('lab:') && o.say) {
        void io.call('point_at', { target: ref.slice(4), text: sayL6(o.say, io.lang()), tone: 'warn' });
      }
      if (o.kind === 'finding' && ref.startsWith('part:')) {
        void io.call('point_at', { target: ref.slice(5), text: t(io, R.finding), tone: 'warn' });
      }
    },
  };
}
