export interface NoteSnapshot { text: string; anchor: number; cursor: number; }
export type Boundaries = (text: string) => number[];

/** Portable editing state. Offsets are UTF-16; the host supplies Unicode grapheme boundaries. */
export class NoteModel {
  text: string;
  anchor: number;
  cursor: number;
  private boundaries: Boundaries;
  private past: NoteSnapshot[] = [];
  private future: NoteSnapshot[] = [];
  constructor(text: string, boundaries: Boundaries) {
    this.text = text; this.anchor = text.length; this.cursor = text.length; this.boundaries = boundaries;
  }
  get start(): number { return Math.min(this.anchor, this.cursor); }
  get end(): number { return Math.max(this.anchor, this.cursor); }
  get selectedText(): string { return this.text.slice(this.start, this.end); }
  snapshot(): NoteSnapshot { return {text: this.text, anchor: this.anchor, cursor: this.cursor}; }
  private restore(value: NoteSnapshot): void { Object.assign(this, value); }
  insert(value: string, before: NoteSnapshot = this.snapshot()): void {
    if (value === '' && this.start === this.end) { return; }
    this.past.push(before); this.past = this.past.slice(-100); this.future = [];
    const start = this.start;
    this.text = this.text.slice(0, start) + value + this.text.slice(this.end);
    this.anchor = this.cursor = start + value.length;
  }
  move(direction: number, extend: boolean): void {
    if (!extend && this.start !== this.end) { this.cursor = direction < 0 ? this.start : this.end; }
    else {
      const candidates = this.boundaries(this.text);
      this.cursor = direction < 0 ? [...candidates].reverse().find(v => v < this.cursor) ?? 0 :
        candidates.find(v => v > this.cursor) ?? this.text.length;
    }
    if (!extend) { this.anchor = this.cursor; }
  }
  erase(direction: number): void {
    const before = this.snapshot();
    if (this.start === this.end) {
      const original = this.cursor;
      this.move(direction, true);
      this.anchor = original;
    }
    this.insert('', before);
  }
  selectAll(): void { this.anchor = 0; this.cursor = this.text.length; }
  home(extend: boolean): void { this.cursor = 0; if (!extend) { this.anchor = 0; } }
  endOfDocument(extend: boolean): void { this.cursor = this.text.length; if (!extend) { this.anchor = this.cursor; } }
  undo(): void {
    const prior = this.past.pop(); if (prior) { this.future.push(this.snapshot()); this.restore(prior); }
  }
  redo(): void {
    const next = this.future.pop(); if (next) { this.past.push(this.snapshot()); this.restore(next); }
  }
}
