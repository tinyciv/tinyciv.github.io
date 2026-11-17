import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as people from '../src/game/unit-sprites';
import * as combat from '../src/game/combat-effect-art';
import { NativeArt, unitKey } from '../src/game/native-art';
import { MountedAnimationClock } from '../src/game/mounted-animation';
import { person } from './helpers/research-income';

describe('approved crowned leader 1A', () => {
  it('ships nine native poses for each of eight directions', () => {
    expect(people.PUNY_CHARACTERS.leader.file).toBe('Crowned-Leader.png');
    const png = readFileSync('public/assets/puny-world/characters/Crowned-Leader.png');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([288, 256]);
    expect(people.PUNY_CHARACTERS.marauderChief.file).toBe('Warrior-Blue.png');
  });
  it('plays four walk frames and four attack frames in all eight directions', () => {
    const unit = { ...person(0, 'leader'), id: 0, attackTime: 0, moving: false };
    for (const [row, facing] of [Math.PI/2, Math.PI/4, 0, -Math.PI/4, -Math.PI/2, -3*Math.PI/4, Math.PI, 3*Math.PI/4].entries()) {
      expect(people.personFrame({ ...unit, facing }, 0)).toEqual({ role: 'leader', row, frame: 0 });
      expect([0,1,2,3].map(n => people.personFrame({ ...unit, facing, moving: true }, (n+.1)/9).frame)).toEqual([1,2,3,4]);
      expect([.28,.20,.12,.04].map(attackTime => people.personFrame({ ...unit, facing, attackTime }, 0).frame)).toEqual([5,6,7,8]);
    }
    expect(people.personFrame({ ...unit, kind:'warrior', marauderLeader:true, attackTime:.28 }, 0).role).toBe('marauderChief');
    const clock = new MountedAnimationClock();
    clock.advance(.1, { speed:1, paused:false, gameOver:false });
    expect(clock.forUnit('leader', 20)).toBe(.1);
  });
  it('uses identical native frames and anchors for normal and damage rendering', () => {
    const sheet = {} as HTMLCanvasElement, mask = {} as HTMLCanvasElement;
    const palette = vi.spyOn(people, 'factionSheet').mockReturnValue(sheet);
    const damage = vi.spyOn(combat, 'damageMaskSheet').mockReturnValue(mask);
    const image = vi.fn(() => ({ texture:null })), paint = vi.fn();
    const art = Object.assign(Object.create(NativeArt.prototype), { image, paint }) as NativeArt;
    const unit = { ...person(0,'leader'), facing:0, moving:true, attackTime:0, armorLevel:3 as const };
    try {
      const pose = people.personFrame(unit,.2), rect=[pose.frame*32,pose.row*32,32,32];
      const bounds={x:-6.4,y:-4.44,width:44.8,height:44.8};
      art.unit(unit,.2,'#c94c4c');expect(image).toHaveBeenLastCalledWith(sheet,rect,bounds);
      art.unit(unit,.2,'#c94c4c',{damageMask:true});expect(image).toHaveBeenLastCalledWith(mask,rect,bounds);
      expect(paint).not.toHaveBeenCalled();expect(unitKey(unit,.2,'#c94c4c')).toContain('person:leader:');
    } finally { palette.mockRestore();damage.mockRestore(); }
  });
  it('retains the robe at every armor level and recolors only its faction cloth', async () => {
    vi.stubGlobal('Image', class {
      src='';get naturalWidth(){const f=this.src.split('/').pop();return f==='Scout.png'?128:['Crowned-Leader.png','Club-Warrior.png','Militia.png','Skirmisher.png','Slinger.png'].includes(f!)?288:768;}
      naturalHeight=256;get width(){return this.naturalWidth;}height=256;async decode(){}
    });
    const pixels=new Uint8ClampedArray([0,121,102,255,220,174,70,255,238,185,136,255]);
    const drawImage=vi.fn(),putImageData=vi.fn();
    vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage,getImageData:()=>({data:new Uint8ClampedArray(pixels)}),putImageData})})});
    try {
      await people.loadPunyCharacters();
      const basic=people.factionSheet('leader','#c86432',0);
      for (const level of [1,2,3,4,5,6]) expect(people.factionSheet('leader','#c86432',level)).toBe(basic);
      expect(drawImage).toHaveBeenCalledTimes(1);
      expect([...putImageData.mock.calls[0][0].data]).toEqual([156,78,39,255,220,174,70,255,238,185,136,255]);
    } finally {vi.unstubAllGlobals();}
  });
});
