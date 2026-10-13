/** Experimental shared Rust-kit authoring data. No DOM, text measurement, shaders or host actions. */
export type Material = 'glass' | 'ceramic' | 'metal' | 'emissive' | 'clear';
export type Kind = 'column' | 'row' | 'panel' | 'label' | 'button' | 'slider' | 'sun-path' | 'orb' | 'art';
export interface View {
  id: string; kind: Kind; width?: number; height?: number; gap?: number; padding?: number;
  material?: Material; elevation?: number; radius?: number; text?: string; icon?: string;
  value?: number; action?: string; borderBottom?: boolean; borderRight?: boolean;
  textRole?: 'body' | 'caption' | 'title'; tone?: 'primary' | 'secondary';
  sliderStyle?: 'standard' | 'volume'; iconPlacement?: 'leading' | 'only'; children?: View[];
}
export interface Scene { schema: 'spaos.kit.experimental/1'; root: View; }
export const column = (id: string, children: View[], options: Partial<View> = {}): View => ({id, kind:'column', children, ...options});
export const row = (id: string, children: View[], options: Partial<View> = {}): View => ({id, kind:'row', children, ...options});
export const label = (id: string, text: string, options: Partial<View> = {}): View => ({id, kind:'label', text, ...options});
export const button = (id: string, text: string, action: string, options: Partial<View> = {}): View => ({id, kind:'button', text, action, ...options});
export const slider = (id: string, value: number, action: string, options: Partial<View> = {}): View => ({id, kind:'slider', value, action, ...options});
