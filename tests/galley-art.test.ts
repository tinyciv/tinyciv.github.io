import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { galleyPose, galleyAttachmentOffset, drawGalleyPassenger, GALLEY_ART_BOUNDS } from '../src/game/galley-art';
import * as characters from '../src/game/unit-sprites';
import { NativeArt, unitKey, type BakedArt } from '../src/game/native-art';
import type { Unit } from '../src/game/types';
import metadata from '../public/assets/naval/galley-source.json';
import { punyAtlas } from './puny-atlas';
const boat = (facing=0,moving=false) => ({kind:'sailboat',id:7,facing,moving} as Unit);
const leader = {kind:'leader',id:8,inside:true,moving:true,attackTime:.25,armorLevel:2,cargo:4} as Unit;

describe('approved galley integration',()=>{
  it('ships all24 approved frames and exact cardinal hull/rig composites',()=>{
    for(const file of metadata.files) expect(createHash('sha256').update(readFileSync(`public/assets/naval/${file.file}`)).digest('hex')).toBe(file.sha256);
    const full=punyAtlas(new URL('../public/assets/naval/galley.png',import.meta.url));
    const hull=punyAtlas(new URL('../public/assets/naval/galley-hulls.png',import.meta.url));
    const rig=punyAtlas(new URL('../public/assets/naval/galley-rigs.png',import.meta.url));
    expect([full.width,full.height]).toEqual([192,128]);
    for(let row=0;row<4;row++)for(let frame=0;frame<6;frame++)for(let y=0;y<32;y++)for(let x=0;x<32;x++){
      const offset=((row*32+y)*192+frame*32+x)*4,r=((row*32+y)*32+x)*4;
      const composited=rig.data[r+3]?rig.data.subarray(r,r+4):hull.data.subarray(offset,offset+4);
      expect([...composited]).toEqual([...full.data.subarray(offset,offset+4)]);
    }
  });
  it('rows only while moving and keeps heading and animation cache bounded',()=>{
    expect([0,Math.PI/2,Math.PI,-Math.PI/2].map(facing=>galleyPose(boat(facing)).row)).toEqual([1,2,3,0]);
    expect(Array.from({length:6},(_,i)=>galleyPose(boat(0,true),i*.14+.001).frame)).toEqual([0,1,2,3,4,5]);
    expect(galleyPose(boat(),123).frame).toBe(0);
    const keys=new Set<string>();for(let i=0;i<2000;i++)keys.add(unitKey(boat(i/31,true),i/47,'#c94c4c'));
    expect(keys.size).toBe(24);
    expect(GALLEY_ART_BOUNDS).toEqual({x:-16,y:-16,width:64,height:64});
  });
  it('moves upright rig and captain with their deck attachments while turning',()=>{
    expect(galleyAttachmentOffset(boat(), 'rig')).toEqual({x:0,y:0});
    expect(galleyAttachmentOffset(boat(.4), 'captain')).not.toEqual({x:0,y:0});
    const draw=vi.spyOn(characters,'drawPerson').mockImplementation(()=>{});
    const c={save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn(),rotate:vi.fn()} as unknown as CanvasRenderingContext2D;
    try{drawGalleyPassenger(c,boat(.4),leader,0,0,32,'#c94c4c');
      expect(draw).toHaveBeenCalledWith(c,expect.objectContaining({kind:'leader',inside:false,moving:false,attackTime:0,cargo:0,armorLevel:2,facing:.4}),0,'#c94c4c');
      expect(c.rotate).not.toHaveBeenCalled();expect(leader.inside).toBe(true);
    }finally{draw.mockRestore();}
  });
  it('removes the captain overlay after landing, and draws the upright sail last',()=>{
    const art=new NativeArt();vi.spyOn(art,'paint').mockImplementation((_key,bounds)=>({...bounds,texture:null!} as BakedArt));
    expect(art.unit(boat(.4),0,'#c94c4c').overlays).toHaveLength(1);
    const occupied=art.unit(boat(.4),0,'#c94c4c',{passenger:leader});
    expect(occupied.overlays).toHaveLength(2);expect(occupied.overlays![1].height).toBe(64);
    expect(occupied.overlays!.every(x=>x.rotation===undefined)).toBe(true);
  });
});
