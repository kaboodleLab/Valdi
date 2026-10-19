import {ControlPanel} from './control-panel';
import type {Event} from './control-panel';
declare const spatialHost: {subscribe(callback:(event:Event)=>void):void; emit(scene:unknown):void};
const panel = new ControlPanel();
spatialHost.subscribe(event => { panel.apply(event); spatialHost.emit(panel.scene()); });
spatialHost.emit(panel.scene());
