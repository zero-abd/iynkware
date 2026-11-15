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
import type { Brain, BrainIO } from './bridge';

export type Intent =
  | { readonly kind: 'undo' | 'redo' | 'yes' | 'all' | 'no' | 'next' | 'wrong' | 'fix' }
  | { readonly kind: 'edit'; readonly action: 'removePart' | 'pullPart' | 'turnPart'; readonly thing: string; readonly half?: boolean }
  | { readonly kind: 'sim'; readonly action: 'run' | 'pause' | 'stop' }
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
  if (/do the rest|accept all|alle annehmen|mach den rest/.test(t)) return { kind: 'all' };
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
  if (/\bbuild\b|\bbau(?:e|en)?\b|aufbauen/.test(t)) return { kind: 'build', request: /with me|mit mir/.test(t) && !/blink/.test(t) ? 'build it with me' : t };
  if (/what (?:should i do )?next|next step|what now|what do i do|als nächstes|nächster schritt|was jetzt|was soll ich/.test(t)) return { kind: 'next' };
  const w = WHERE.exec(t);
  if (w) {
    const thing = t.slice(w[0].length).replace(ARTICLE, '').trim();
    if (thing) return { kind: 'where', thing: NOUNS[thing] ?? thing };
  }
  return { kind: 'unknown' };
}

const QUESTIONS = (io: BrainIO) => AGENT_TEXT.questions.map((q) => sayL6(q, io.lang()));

export function scriptedBrain(): Brain {
  const t = (io: BrainIO, s: L6, vars?: Parameters<typeof fill>[1]) => sayL6(vars ? fill(s, vars) : s, io.lang());
  const R = AGENT_TEXT.reply;
  return {
    name: 'scripted',
    async turn({ text }, io) {
      const intent = intentOf(text);
      const done = (s: string, suggestions?: readonly string[]) => io.say(s, { final: true, suggestions });
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
          return done(t(io, R.cannotBuild));
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
