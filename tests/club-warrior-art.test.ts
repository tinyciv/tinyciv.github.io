import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as people from '../src/game/unit-sprites';
import { NativeArt, unitKey } from '../src/game/native-art';
import { person } from './helpers/research-income';

describe('club warrior and swordsman artwork', () => {
  it('loads the compact club sheet and preserves the original armored sheet for swordsmen', () => {
    expect(people.PUNY_CHARACTERS.warrior.file).toBe('Club-Warrior.png');
    expect(people.PUNY_CHARACTERS.swordsman.file).toBe('Human-Soldier-Cyan.png');
    for (const [role,width] of [['warrior',288],['swordsman',768]] as const) {
      const data=readFileSync(`public/assets/puny-world/characters/${people.PUNY_CHARACTERS[role].file}`);
      expect([data.readUInt32BE(16),data.readUInt32BE(20)]).toEqual([width,256]);
    }
  });
  it.each(['warrior','swordsman'] as const)('renders %s walking and attacking in all eight directions through the live renderer',kind=>{
    const sheet={} as HTMLCanvasElement;
    const palette=vi.spyOn(people,'factionSheet').mockReturnValue(sheet);
    const image=vi.fn(()=>({texture:null})),paint=vi.fn();
    const art=Object.assign(Object.create(NativeArt.prototype),{image,paint}) as NativeArt;
    try {
      const unit={...person(0,kind),facing:0,moving:false,attackTime:0};
      for(const [row,facing] of [Math.PI/2,Math.PI/4,0,-Math.PI/4,-Math.PI/2,-3*Math.PI/4,Math.PI,3*Math.PI/4].entries()) {
        expect(people.personFrame({...unit,facing},0)).toEqual({role:kind,row,frame:0});
        for(const [phase,attackTime] of [.28,.20,.12,.04].entries()) {
          const pose={...unit,facing,attackTime};art.unit(pose,0,'#f34f59');
          expect(image).toHaveBeenLastCalledWith(sheet,[(5+phase)*32,row*32,32,32],{x:-6.4,y:-4.44,width:44.8,height:44.8});
        }
      }
      expect(new Set([0,1,2,3].map(phase=>people.personFrame({...unit,moving:true},phase/9).frame))).toEqual(new Set([1,2,3,4]));
      expect(unitKey(unit,0,'#f34f59')).not.toContain('empty');expect(paint).not.toHaveBeenCalled();
    } finally {palette.mockRestore();}
  });
});
