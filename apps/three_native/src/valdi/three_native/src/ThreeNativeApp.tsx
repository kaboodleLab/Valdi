import { StatefulComponent } from 'valdi_core/src/Component';
import { getModuleFileEntryAsBytes } from 'valdi_core/src/Valdi';
import { createPlatterScene, PlatterScene } from './prepareScene';

/** @ViewModel @ExportModel */
export interface ViewModel {}

/** @Context @ExportModel */
export interface ComponentContext {}

interface State {
  frame: number;
  error: string;
}

/** @Component @ExportModel */
export class App extends StatefulComponent<ViewModel, State, ComponentContext> {
  state: State = { frame: 0, error: '' };
  private scene: PlatterScene | undefined;
  private transformBytes: Uint8Array = new Uint8Array(128);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTime = 0;
  private destroyed = false;
  private dragYaw = 0;
  private dragStartYaw = 0;
  private viewWidth = 1;
  private viewHeight = 1;

  onCreate(): void {
    const bytes = getModuleFileEntryAsBytes('three_native', 'src/ui-platter-base.glb.bin');
    createPlatterScene(bytes).then((scene) => {
      if (this.destroyed) { scene.dispose(); return; }
      this.scene = scene;
      scene.resize(this.viewWidth, this.viewHeight);
      this.lastTime = Date.now();
      this.tick();
    }, (error: Error) => {
      if (!this.destroyed) this.setState({ error: error.message });
    });
  }

  private tick = (): void => {
    if (this.destroyed || !this.scene) return;
    const now = Date.now();
    this.transformBytes = this.scene.frame((now - this.lastTime) / 1000, this.dragYaw);
    this.lastTime = now;
    this.setState({ frame: this.state.frame + 1 });
    this.timer = setTimeout(this.tick, 33);
  };

  onDestroy(): void {
    this.destroyed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.scene?.dispose();
    this.scene = undefined;
  }

  onRender(): void {
    <view width="100%" height="100%" backgroundColor="#101827"
      onLayout={(frame) => {
        this.viewWidth = frame.width;
        this.viewHeight = frame.height;
        this.scene?.resize(frame.width, frame.height);
        if (this.scene) this.transformBytes = this.scene.frame(0, this.dragYaw);
      }}
      onDrag={(event) => {
        if (event.state === 0) this.dragStartYaw = this.dragYaw;
        this.dragYaw = this.dragStartYaw + event.deltaX * 0.01;
      }}>
      <custom-view
        iosClass="UIView"
        androidClass="com.snap.valdi.three_native.ThreeSurfaceView"
        width="100%"
        height="100%"
        meshBytes={this.scene?.vertexBytes}
        transformBytes={this.transformBytes}
      />
      {this.state.error ? <label value={this.state.error} color="white" /> : null}
    </view>;
  }
}
