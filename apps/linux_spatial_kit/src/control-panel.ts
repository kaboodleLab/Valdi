import {column, row, label, button, slider} from './kit';
import type {Scene, View} from './kit';
export interface Event { action: string; value?: number; }
export class ControlPanel {
  wifi = true; bluetooth = false; playing = true; brightness = .92; volume = .43; time = .5;
  apply(event: Event): void {
    switch(event.action) {
      case 'wifi': this.wifi = !this.wifi; break;
      case 'bluetooth': this.bluetooth = !this.bluetooth; break;
      case 'play': this.playing = !this.playing; break;
      case 'daylight': this.time = Math.max(0, Math.min(1, event.value ?? .5)); break;
      case 'reset-daylight': this.time = .5; break;
      case 'brightness': this.brightness = Math.max(0, Math.min(1, event.value ?? .92)); break;
      case 'volume': this.volume = Math.max(0, Math.min(1, event.value ?? .43)); break;
    }
  }
  scene(): Scene {
    const connection = (id: string, text: string, icon: string, action: string): View => button(id,text,action,{height:76,icon,padding:20,borderBottom:true});
    return {schema:'spaos.kit.experimental/1', root:{
      id:'control-panel',kind:'panel',width:320,height:468,material:'glass',radius:28,padding:0,
      children:[column('sections',[
        row('connections-and-media',[
          column('connections',[
            connection('wifi',this.wifi ? 'KB-Wifi' : 'Wifi off','wifi','wifi'),
            connection('bluetooth',this.bluetooth ? 'Bluetooth on' : 'Bluetooth','bluetooth','bluetooth'),
            connection('connected','Connected','connected',''),
          ],{width:160,borderRight:true}),
          column('media',[
            {id:'album',kind:'art',width:128,height:128,elevation:12,material:'ceramic',radius:16},
            label('track','DHL',{height:22}),label('artist','Frank Ocean',{height:16,textRole:'caption',tone:'secondary'}),
            row('transport',[
              button('previous','Previous track','previous',{width:38,height:32,icon:'previous',iconPlacement:'only'}),
              button('play',this.playing ? 'Pause playback' : 'Play playback','play',{width:38,height:32,icon:this.playing ? 'pause' : 'play',iconPlacement:'only'}),
              button('next','Next track','next',{width:38,height:32,icon:'next',iconPlacement:'only'}),
            ],{gap:8,height:32}),
          ],{width:160,padding:12}),
        ],{height:232,borderBottom:true}),
        row('daylight-row',[
          {id:'daylight',kind:'sun-path',height:56,width:248,value:this.time,action:'daylight',elevation:8, children:[{id:'sun-knob',kind:'orb',width:18,height:18,elevation:8,material:'emissive'}]},
          button('reset','Reset daylight','reset-daylight',{icon:'reset',iconPlacement:'only',width:52,height:56,elevation:6,material:'ceramic'}),
        ],{height:76,gap:0,padding:10,borderBottom:true}),
        slider('brightness',this.brightness,'brightness',{height:76,borderBottom:true,icon:'brightness',padding:20,elevation:5,material:'ceramic'}),
        slider('volume',this.volume,'volume',{height:84,sliderStyle:'volume',icon:'volume',padding:20,elevation:3,material:'ceramic'}),
      ])],
    }};
  }
}
