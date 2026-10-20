/** Experimental host presentation metadata. Layer names resolve only inside this component tree. */
export interface PresentationText { length: number; anchor: number; cursor: number; preview: string; }
export interface PresentationNode {
  key: string;
  parent: string;
  layer: string;
  clipLayer?: string;
  role: 'group' | 'button' | 'text' | 'text-input' | 'status';
  label: string;
  disabled?: boolean;
  focused?: boolean;
  text?: PresentationText;
}
export interface PresentationDescription { nodes: PresentationNode[]; }
