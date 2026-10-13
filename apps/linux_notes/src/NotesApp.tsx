import { StatefulComponent } from 'valdi_core/src/Component';
import { UnicodeString } from 'coreutils/src/unicode/UnicodeString';
import { AttributedTextBuilder } from 'valdi_core/src/utils/AttributedTextBuilder';
import { PresentationDescription } from 'valdi_core/src/Presentation';
import { NoteModel } from './NoteModel';

interface Input { type: string; text: string; ctrl: boolean; shift: boolean; index?: number; }
interface DesktopContext {
  publishContent(description: PresentationDescription): void;
  subscribeInput(handler: (event: Input) => void): void;
  readDocument(): string;
  saveDocument(text: string): boolean;
  readClipboard(): string;
  writeClipboard(text: string): boolean;
  publishState(state: {text: string; cursor: number; anchor: number}): void;
  storageEnabled: boolean;
}
interface State { revision: number; status: string; composition: string; }

function boundaries(text: string): number[] {
  const unicode = UnicodeString.fromString(text);
  const values = [0];
  let offset = 0;
  for (let i = 0; i < unicode.length; i++) {
    if (i > 0 && !unicode.isFromGraphemeClusterAt(i)) { values.push(offset); }
    offset += unicode.getCodepointAt(i) > 0xffff ? 2 : 1;
  }
  if (offset !== 0) { values.push(offset); }
  return values;
}

/** An app-owned experimental editor using the desktop host's narrow input and storage adapter. */
export class NotesApp extends StatefulComponent<{}, State, DesktopContext> {
  state: State = { revision: 0, status: 'Ready', composition: '' };
  private model = new NoteModel('', boundaries);
  private savedText = '';
  onCreate(): void {
    this.savedText = this.context.readDocument();
    this.model = new NoteModel(this.savedText, boundaries);
    this.context.subscribeInput(event => this.input(event));
    this.publish();
  }
  onDestroy(): void { this.context.subscribeInput(() => {}); }
  private publish(): void {
    this.context.publishState(this.model.snapshot());
    let preview = this.model.text.slice(0, 4096);
    const last = preview.charCodeAt(preview.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) { preview = preview.slice(0, -1); }
    this.context.publishContent({nodes: [
      {key: 'notes.toolbar', parent: 'root', layer: 'note-header', role: 'group', label: 'Notes toolbar'},
      {key: 'notes.save', parent: 'notes.toolbar', layer: 'save-note', role: 'button', label: 'Save note'},
      {key: 'notes.editor', parent: 'root', layer: 'note-editor', role: 'group', label: 'Note editor'},
      {key: 'notes.text', parent: 'notes.editor', layer: 'note-editor', clipLayer: 'note-editor', role: 'text-input', label: 'Note',
        focused: true, text: {length: this.model.text.length, anchor: this.model.anchor, cursor: this.model.cursor, preview}},
      {key: 'notes.status', parent: 'root', layer: 'note-status', role: 'status', label: this.state.status},
    ]});
  }
  private save = (): void => {
    const saved = this.context.saveDocument(this.model.text);
    if (saved) { this.savedText = this.model.text; }
    this.setState({ status: saved ? 'Saved locally' : 'Save unavailable' });
    this.publish();
  };
  private input(event: Input): void {
    if (event.type === 'composition') { this.setState({composition: event.text}); return; }
    if (event.type === 'pointer' && event.index !== undefined) { this.model.place(event.index, event.shift); }
    if (event.type === 'text') { this.model.insert(event.text); }
    if (event.type === 'key') {
      const key = event.text.toLowerCase();
      if (event.ctrl) {
        switch (key) {
          case 'a': this.model.selectAll(); break;
          case 's': this.save(); return;
          case 'c': this.context.writeClipboard(this.model.selectedText); return;
          case 'x': this.context.writeClipboard(this.model.selectedText); this.model.insert(''); break;
          case 'v': this.model.insert(this.context.readClipboard()); break;
          case 'z': event.shift ? this.model.redo() : this.model.undo(); break;
          case 'y': this.model.redo(); break;
          case 'home': this.model.home(event.shift); break;
          case 'end': this.model.endOfDocument(event.shift); break;
          default: return;
        }
      } else {
        switch (key) {
          case 'left': this.model.move(-1, event.shift); break;
          case 'right': this.model.move(1, event.shift); break;
          case 'home': this.model.home(event.shift); break;
          case 'end': this.model.endOfDocument(event.shift); break;
          case 'backspace': this.model.erase(-1); break;
          case 'delete': this.model.erase(1); break;
          case 'return': this.model.insert('\n'); break;
          case 'tab': this.model.insert('    '); break;
          default: return;
        }
      }
    }
    this.setState({revision: this.state.revision + 1, status: this.model.text === this.savedText ? 'Saved locally' : 'Unsaved changes', composition: ''});
    this.publish();
  }
  onRender(): void {
    const text = this.model.text;
    const preview = this.model.start === this.model.end ? text : new AttributedTextBuilder()
      .append(text.slice(0, this.model.start))
      .append(this.model.selectedText, {backgroundColor: '#345e81', color: '#ffffff'})
      .append(text.slice(this.model.end))
      .build();
    <view backgroundColor='#101419' width='100%' height='100%' flexDirection='column'>
      <view accessibilityId='note-header' padding={24} flexDirection='row' alignItems='center' backgroundColor='#1b232c'>
        <view flexGrow={1}>
          <label value='Notes' font='FreeSans-Bold 25' color='#f0f5fa' />
          <label value='Local notes · Linux prototype' font='FreeSans 13' color='#9caab9' marginTop={6} />
        </view>
        <view padding={12} backgroundColor='#356c91' borderRadius={8} onTap={this.save} accessibilityId='save-note'>
          <label value='Save  Ctrl+S' font='FreeSans 14' color='white' />
        </view>
      </view>
      <scroll flexGrow={1} width='100%' padding={28} backgroundColor='#101419' accessibilityId='note-editor'>
        <label accessibilityId='note-text' value={preview} font='FreeSans 20' color='#e0e8ee' width='100%' numberOfLines={0} />
        {this.state.composition ? <label value={`Composing: ${this.state.composition}`} color='#8ac3e5' font='FreeSans 16' /> : undefined}
        {!text ? <label value='Start typing. Your note stays on this machine.' color='#7e8b99' font='FreeSans 16' marginTop={16} /> : undefined}
      </scroll>
      <view padding={14} backgroundColor='#1b232c' flexDirection='row'>
        <label accessibilityId='note-status' value={this.state.status} font='FreeSans 13' color='#9ad8ae' flexGrow={1} />
        <label value={`${UnicodeString.fromString(text).countGraphemeClusters()} characters · Ctrl+A select · Ctrl+Z undo`} font='FreeSans 12' color='#9caab9' />
      </view>
    </view>;
  }
}
