/**
 * A small C/C++/Python/MicroPython tokenizer for the Code tab's colours (design 7.2): one `TokenKind` per character, so
 * the view can split a line anywhere (at a chip) without re-tokenizing. Not a parser: strings and comments are exact,
 * words are keyword, type, function (a word before `(`), number, or plain.
 */
import type { TokenKind } from '../types';

const C_KEYWORDS = new Set(
  'if else for while do switch case default break continue return const static volatile void struct class enum union typedef sizeof new delete true false HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN namespace using public private template nullptr NULL goto extern inline'.split(' '),
);
const C_TYPES = new Set(
  'int long short char float double bool boolean byte unsigned signed word size_t String uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t auto'.split(' '),
);
const PY_KEYWORDS = new Set(
  'def class if elif else for while in not and or return import from as pass break continue True False None with try except finally raise lambda is global nonlocal yield del assert async await'.split(' '),
);
const PY_TYPES = new Set('int str float bool list dict tuple bytes'.split(' '));

export function isPython(language: string): boolean {
  return /python/i.test(language);
}

const isStart = (c: string) => /[A-Za-z_]/.test(c);
const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

/** The kind of every UTF-16 unit of `code`. */
export function tokenize(code: string, language: string): TokenKind[] {
  const py = isPython(language);
  const kinds: TokenKind[] = new Array<TokenKind>(code.length).fill('plain');
  const paint = (from: number, to: number, kind: TokenKind) => {
    for (let i = from; i < to; i++) kinds[i] = kind;
  };
  const keywords = py ? PY_KEYWORDS : C_KEYWORDS;
  const types = py ? PY_TYPES : C_TYPES;
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    const next = code[i + 1];
    if (!py && c === '/' && next === '/') {
      let e = code.indexOf('\n', i);
      if (e < 0) e = code.length;
      paint(i, e, 'comment');
      i = e;
    } else if (!py && c === '/' && next === '*') {
      let e = code.indexOf('*/', i + 2);
      e = e < 0 ? code.length : e + 2;
      paint(i, e, 'comment');
      i = e;
    } else if (py && c === '#') {
      let e = code.indexOf('\n', i);
      if (e < 0) e = code.length;
      paint(i, e, 'comment');
      i = e;
    } else if (c === '"' || c === "'") {
      let e = i + 1;
      while (e < code.length && code[e] !== c && code[e] !== '\n') e += code[e] === '\\' ? 2 : 1;
      e = Math.min(code.length, e + 1);
      paint(i, e, 'string');
      i = e;
    } else if (!py && c === '#' && /^[ \t]*$/.test(code.slice(code.lastIndexOf('\n', i - 1) + 1, i))) {
      let e = i + 1;
      while (e < code.length && isWord(code[e]!)) e++;
      paint(i, e, 'keyword');
      i = e;
    } else if (isDigit(c) || (c === '.' && next !== undefined && isDigit(next))) {
      let e = i + 1;
      while (e < code.length && /[0-9a-fA-FxXbB._]/.test(code[e]!)) e++;
      paint(i, e, 'number');
      i = e;
    } else if (isStart(c)) {
      let e = i + 1;
      while (e < code.length && isWord(code[e]!)) e++;
      const word = code.slice(i, e);
      let k = e;
      while (code[k] === ' ') k++;
      if (keywords.has(word)) paint(i, e, 'keyword');
      else if (types.has(word)) paint(i, e, 'type');
      else if (code[k] === '(') paint(i, e, 'function');
      i = e;
    } else i++;
  }
  return kinds;
}
