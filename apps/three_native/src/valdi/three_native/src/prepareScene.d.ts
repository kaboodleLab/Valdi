export interface PlatterScene {
  readonly vertexBytes: Uint8Array;
  readonly vertexCount: number;
  resize(width: number, height: number): void;
  frame(deltaSeconds: number, dragYaw?: number): Uint8Array;
  dispose(): void;
}

export function createPlatterScene(bytes: Uint8Array): Promise<PlatterScene>;
