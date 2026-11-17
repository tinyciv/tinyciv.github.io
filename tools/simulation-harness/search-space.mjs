import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const LOGIC_SCHEMA=JSON.parse(readFileSync(new URL('../../src/game/faction-ai-logic-schema.json',import.meta.url),'utf8'));
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function canonical(value) {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const genome=policy=>({parameters:policy.parameters,features:policy.features,logic:policy.logic??{}});
export const genomeHash=policy=>hash(genome(policy));
export function randomSource(seed) {
  let state=parseInt(hash(seed).slice(0,8),16)||1;
  return {get state(){return state;},set state(value){state=value>>>0;},next(){state^=state<<13;state^=state>>>17;state^=state<<5;state>>>=0;return state/4294967296;}};
}
const fact=name=>({fact:name}),param=name=>({parameter:name}),op=(name,...args)=>({op:name,args});
// Starting hypotheses are compositions of observed facts, not named policy branches.
// Structural mutations below can insert, replace, delete and recombine subtrees.
export const TEMPLATES={
  retreat:op('or',op('lt',fact('hp'),op('mul',fact('maxHp'),param('retreatHealth'))),
    op('and',op('gt',fact('enemyPower'),op('mul',fact('friendlyPower'),param('retreatPowerRatio'))),op('gt',fact('distanceHome'),3))),
  hunt:op('and',op('not',fact('fortified')),op('ge',fact('friendlyPower'),op('mul',fact('enemyPower'),param('huntPowerRatio')))),
  campaign:op('le',fact('danger'),op('mul',fact('projectedPower'),param('campaignSafetyRatio'))),
  campaignRank:op('add',fact('travelSeconds'),op('mul',op('div',fact('danger'),op('max',1,fact('friendlyPower'))),param('campaignDangerWeight'))),
  garrison:op('if',op('ge',fact('towers'),param('towerGarrisonCount')),0,op('max',1,op('mul',fact('army'),param('garrisonFraction')))),
  huntRank:op('add',op('div',fact('reward'),op('add',5,op('add',fact('distance'),op('mul',6,op('div',fact('enemyPower'),op('max',1,fact('friendlyPower'))))))),fact('continuity')),
  housingPriority:op('and',op('lt',op('sub',fact('housing'),fact('population')),op('max',6,op('mul',.2,fact('population')))),op('gt',fact('foodCapacity'),op('add',fact('population'),2))),
  siegeHold:op('and',op('gt',fact('engines'),0),op('or',op('gt',fact('defenses'),0),op('gt',fact('palaceHealth'),.35))),
};
export const DEFAULT_BOUNDS={
  retreatHealth:[.25,.8],retreatPowerRatio:[.8,2.5],huntPowerRatio:[.65,1.8],garrisonFraction:[0,.4],
  campaignSafetyRatio:[.65,1.5],campaignDangerWeight:[0,80],retreatMorale:[0,60],
  recoveryHealth:[.65,1],recoveryMorale:[60,100],recoveryPowerRatio:[.1,1.5],
  housingOrdersPerCycle:[2,12],developmentInterval:[2,10],cityLimit:[2,10,1],populationPerCity:[20,65],
  reserveUpkeepCycles:[1,3],campaignCooldown:[10,60],siegeLimit:[1,4,1],fortsPerCity:[1,3,1],
};
const copy=value=>structuredClone(value),pick=(rng,values)=>values[Math.floor(rng.next()*values.length)];
export function validateBounds(bounds,base) {
  if(!bounds||typeof bounds!=='object'||Array.isArray(bounds)||!Object.keys(bounds).length)throw new Error('Search bounds must be a nonempty object');
  for(const [name,range] of Object.entries(bounds))if(!(name in base.parameters)||!Array.isArray(range)||![2,3].includes(range.length)
    ||!range.every(Number.isFinite)||range[0]>=range[1]||range.length===3&&range[2]!==1)throw new Error(`Invalid mutation bounds: ${name}`);
}
function repair(p) {p.recoveryHealth=Math.max(p.recoveryHealth,p.retreatHealth);p.recoveryMorale=Math.max(p.recoveryMorale,p.retreatMorale);p.formationStayCount=Math.min(p.formationStayCount,p.formationEnterCount);}
function paths(node,path=[],out=[]) {out.push(path);if(node&&typeof node==='object'&&Array.isArray(node.args))node.args.forEach((child,i)=>paths(child,[...path,i],out));return out;}
function at(node,path){for(const i of path)node=node.args[i];return node;}
function replace(node,path,replacement){if(!path.length)return replacement;at(node,path.slice(0,-1)).args[path.at(-1)]=replacement;return node;}
export function logicSize(node){return 1+(node&&typeof node==='object'&&Array.isArray(node.args)?node.args.reduce((n,child)=>n+logicSize(child),0):0);}
function compatible(node,decision){if(node&&typeof node==='object') {if(node.fact&&!LOGIC_SCHEMA.decisions[decision].facts.includes(node.fact))return false;if(node.args)return node.args.every(child=>compatible(child,decision));}return true;}
function mutateLogic(rng,decision,tree,donor) {
  const path=pick(rng,paths(tree)),node=at(tree,path),choice=Math.floor(rng.next()*5);
  let replacement;
  if(choice===0&&typeof node==='number')replacement=Math.max(-1e5,Math.min(1e5,node+(rng.next()-.5)*Math.max(1,Math.abs(node))));
  else if(choice===1&&node?.args?.length)replacement=copy(pick(rng,node.args));
  else if(choice===2&&donor)replacement=copy(pick(rng,paths(donor).map(p=>at(donor,p))));
  else if(choice===3&&LOGIC_SCHEMA.decisions[decision].facts.length)replacement=fact(pick(rng,LOGIC_SCHEMA.decisions[decision].facts));
  else replacement=op('if',op(pick(rng,['lt','gt']),fact(pick(rng,LOGIC_SCHEMA.decisions[decision].facts)),pick(rng,[0,1,3,10,40,100])),copy(node),copy(pick(rng,[0,1,TEMPLATES[decision]])));
  const result=replace(copy(tree),path,replacement);
  return logicSize(result)<=LOGIC_SCHEMA.maxInstructions&&compatible(result,decision)?result:copy(TEMPLATES[decision]);
}
export function propose(rng,parent,donor,{id,lane,bounds=DEFAULT_BOUNDS,decisions=Object.keys(TEMPLATES),featureMutations=[]}) {
  const child={id,extends:parent.extends,...copy(genome(parent))};const changes=[];
  if(lane!=='logic') {
    for(let n=0;n<1+Math.floor(rng.next()*3);n++) {
      const name=pick(rng,Object.keys(bounds)),[lo,hi,integer]=bounds[name];
      const current=child.parameters[name],value=rng.next()<.2?lo+rng.next()*(hi-lo):current+(rng.next()-.5)*(hi-lo)*.6;
      child.parameters[name]=Math.max(lo,Math.min(hi,integer?Math.round(value):Number(value.toFixed(5))));changes.push(`mutate ${name}`);
    }
    repair(child.parameters);
    if(featureMutations.length&&rng.next()<.15){const name=pick(rng,featureMutations);child.features[name]=!child.features[name];changes.push(`toggle ${name}`);}
  }
  if(lane!=='parameters') {
    const decision=pick(rng,decisions),existing=child.logic[decision];
    if(existing&&rng.next()<.12){delete child.logic[decision];changes.push(`restore native ${decision}`);}
    else {child.logic[decision]=existing?mutateLogic(rng,decision,existing,donor?.logic?.[decision]):mutateLogic(rng,decision,copy(TEMPLATES[decision]),donor?.logic?.[decision]);changes.push(`${existing?'recombine/mutate':'synthesize'} ${decision}`);}
  }
  return {definition:child,hypothesis:changes.join('; '),parents:[parent.id,...donor&&donor.id!==parent.id?[donor.id]:[]],lane};
}
/** Choose a second parent outside the elite using measured outcomes. This keeps
 * unusual, viable behavior in the pool even when its win count is tied. */
export function diversePolicy(report,excluded) {
  const rows=report.standings.table.filter(row=>!excluded.includes(row.policy));if(!rows.length)return null;
  const features=id=>{const samples=report.rows.flatMap(row=>row.factions.filter(f=>f.policy===id));return ['survivingArmyHP','cities','forts','siegeEngines','population'].map(key=>samples.reduce((n,row)=>n+row[key],0)/samples.length);};
  const reference=features(excluded[0]);
  const ruleDistance=id=>{const candidate=report.rows.flatMap(row=>row.policyDefinitions).find(p=>p.id===id),reference=report.rows.flatMap(row=>row.policyDefinitions).find(p=>p.id===excluded[0]);const a=candidate?.logic??{},b=reference?.logic??{};return new Set([...Object.keys(a),...Object.keys(b)]).size===0?0:[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>canonical(a[k]??null)!==canonical(b[k]??null)).length;};
  return rows.map(row=>({id:row.policy,novelty:ruleDistance(row.policy),distance:features(row.policy).reduce((n,value,i)=>n+Math.abs(value-reference[i])/Math.max(1,Math.abs(reference[i])),0)})).sort((a,b)=>b.distance-a.distance||b.novelty-a.novelty)[0].id;
}
/** Mirrored legs form one observation per scenario+seed, never two independent samples. */
export function pairedEvidence(report,challenger,incumbent) {
  const batches=new Map();
  for(const row of report.rows) {
    if(![row.left,row.right].includes(challenger)||![row.left,row.right].includes(incumbent))continue;
    const key=JSON.stringify([row.scenario,row.seed]);if(!batches.has(key))batches.set(key,[]);batches.get(key).push(row);
  }
  let positive=0,negative=0,tied=0;const byScenario={},bySeed=new Map();
  for(const rows of batches.values()) {
    if(rows.length!==2||rows[0].left!==rows[1].right||rows[0].right!==rows[1].left||rows[0].initialStateHash!==rows[1].initialStateHash)throw new Error('Incomplete or unmatched confirmation pair');
    const delta=rows.reduce((n,row)=>n+(row.winner===challenger?1:row.winner===incumbent?-1:0),0);
    bySeed.set(rows[0].seed,(bySeed.get(rows[0].seed)??0)+delta);
    byScenario[rows[0].scenario]=(byScenario[rows[0].scenario]??0)+delta;
  }
  // Scenarios share an RNG seed, so aggregate scenarios before counting a seed
  // as independent evidence. Both mirrored legs also stay in that observation.
  for(const delta of bySeed.values()){if(delta>0)positive++;else if(delta<0)negative++;else tied++;}
  // Exact one-sided sign test on non-tied independent fixture seeds.
  const n=positive+negative;let probability=1;
  if(n&&positive>negative){let logTerm=-n*Math.log(2);for(let k=1;k<=positive;k++)logTerm+=Math.log(n-k+1)-Math.log(k);let term=Math.exp(logTerm);probability=term;for(let k=positive;k<n;k++){term*=(n-k)/(k+1);probability+=term;}probability=Math.min(1,probability);}
  return {positive,negative,tied,pairs:batches.size,seeds:bySeed.size,signTestP:probability,byScenario};
}
