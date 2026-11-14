/** How many bytes at the end of `bytes` start a UTF-8 character that is not complete yet. */
function incompleteTail(bytes: readonly number[]): number {
  for (let back = 1; back <= Math.min(3, bytes.length); back++) {
    const lead = bytes[bytes.length - back];
    if ((lead & 0xc0) === 0x80) continue;
    const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    return need > back ? back : 0;
  }
  return 0;
}

function decode(bytes: readonly number[]): string {
  let text = "";
  for (let i = 0; i < bytes.length; ) {
    const lead = bytes[i];
    const length = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 0;
    const rest = bytes.slice(i + 1, i + length);
    if (length === 0 || rest.length < length - 1 || rest.some((b) => (b & 0xc0) !== 0x80)) {
      text += "�";
      i++;
      continue;
    }
    const code = length === 1 ? lead : rest.reduce((acc, b) => (acc << 6) | (b & 0x3f), lead & (0xff >> (length + 1)));
    text += String.fromCodePoint(code <= 0x10ffff ? code : 0xfffd);
    i += length;
  }
  return text;
}

/** Collects the bytes a program sends and hands them out as text, keeping a character that is cut short until its rest arrives. */
export class SerialText {
  private pending: number[] = [];

  push(byte: number): void {
    this.pending.push(byte);
  }

  get length(): number {
    return this.pending.length;
  }

  take(): string {
    const keep = incompleteTail(this.pending);
    const ready = this.pending.slice(0, this.pending.length - keep);
    this.pending = this.pending.slice(this.pending.length - keep);
    return decode(ready);
  }
}
