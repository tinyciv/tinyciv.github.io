//! Bounded native decision programs. No loops, callbacks, paths, map scans or
//! access to hidden state: inputs are facts already sampled by the planner.
pub const MAX_INSTRUCTIONS: usize = 64;
pub const MAX_STACK: usize = 16;

#[derive(Clone, Debug)]
pub struct Program { pub words: Vec<f64> }

pub fn fact_count(mode:u32)->Option<usize> {
    Some(match mode {0=>3,1|2=>6,3=>3,4=>2,5=>3,6=>6,7=>3,8=>3,9=>3,10=>2,
        11=>4,12=>3,13=>0,14=>3,15|16=>0,17=>2,18=>1,19=>6,21=>4,22|23=>1,24=>3,26=>6,27=>4,28=>1,29=>6,30=>2,_=>return None})
}
fn arity(op:u32)->Option<usize> {Some(match op {0..=2=>0,10..=19|22|23=>2,20|24|25=>1,21=>3,_=>return None})}

impl Program {
    /// Word pairs [opcode, operand]. Literal=0, fact=1, parameter=2, 
    /// add/sub/mul/div/min/max/lt/le/gt/ge=10..19, not=20, if=21, and/or=22/23.
    /// and/or are binary (special-cased below); ceil/floor=24/25.
    pub fn decode(mode:u32,words:&[f64])->Option<Self> {
        let facts=fact_count(mode)?;
        if words.is_empty()||words.len()%2!=0||words.len()/2>MAX_INSTRUCTIONS{return None;}
        let mut depth=0;
        for row in words.chunks_exact(2) {
            if !row.iter().all(|v|v.is_finite())||row[0].fract()!=0.0||row[0]<0.0{return None;}
            let op=row[0] as u32;
            let count=match op {22|23=>2,24|25=>1,_=>arity(op)?};
            match op {
                0=>if row[1].abs()>1_000_000.0{return None;},
                1=>if row[1]<0.0||row[1].fract()!=0.0||row[1]>=facts as f64{return None;},
                2=>if row[1]<0.0||row[1].fract()!=0.0||row[1]>=super::ai_policy::PARAMETERS as f64{return None;},
                _=>if row[1]!=0.0{return None;},
            }
            if depth<count{return None;}depth=depth-count+1;if depth>MAX_STACK{return None;}
        }
        (depth==1).then(||Self{words:words.to_vec()})
    }
    pub fn evaluate(&self,facts:&[f64;6],parameters:&[f64])->Option<f64> {
        let mut stack=[0.0;MAX_STACK];let mut n=0;
        for row in self.words.chunks_exact(2) {
            let op=row[0] as u32;
            let count=match op {22|23=>2,24|25=>1,_=>arity(op)?};
            let start=n-count;let a=stack[start];let b=if count>=2{stack[start+1]}else{0.0};
            let value=match op {
                0=>row[1],1=>facts[row[1] as usize],2=>parameters[row[1] as usize],
                10=>a+b,11=>a-b,12=>a*b,13=>if b.abs()>1e-9{a/b}else{0.0},14=>a.min(b),15=>a.max(b),
                16=>(a<b) as u8 as f64,17=>(a<=b) as u8 as f64,18=>(a>b) as u8 as f64,19=>(a>=b) as u8 as f64,
                20=>(a==0.0) as u8 as f64,21=>if a!=0.0{b}else{stack[start+2]},
                22=>(a!=0.0&&b!=0.0) as u8 as f64,23=>(a!=0.0||b!=0.0) as u8 as f64,
                24=>a.ceil(),25=>a.floor(),_=>return None,
            };
            if !value.is_finite(){return None;}
            n=start+1;stack[start]=value;
        }
        Some(stack[0])
    }
}

/// Policy estimates may change, but array counts and building/command rules
/// cannot be bypassed by returning malformed values from a program.
pub fn normalize(mode:u32,value:f64,facts:&[f64;6])->f64 {
    match mode {
        0=>value.floor().clamp(0.0,facts[0].max(0.0)),
        1..=4|6|7|11|14|18|21|23|24|26|27|30=>(value!=0.0) as u8 as f64,
        8=>value.ceil().clamp(0.0,10_000.0),
        13|15=>value.floor().clamp(1.0,8.0),16=>value.ceil().clamp(1.0,20.0),
        9|10=>value.clamp(0.0,1e9),12=>value.clamp(0.0,4.0),
        17=>value.floor().clamp(0.0,8.0),19=>value.round().clamp(0.0,2.0),
        28=>value.clamp(30.0,900.0),_=>value.clamp(-1e9,1e9),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn conditional_rules_use_only_declared_observations() {
        let p=Program::decode(1,&[1.0,0.0,1.0,1.0,0.0,0.5,12.0,0.0,16.0,0.0,0.0,1.0,0.0,0.0,21.0,0.0]).unwrap();
        assert_eq!(p.evaluate(&[30.0,100.0,100.0,0.0,1.0,0.0],&[0.0;25]),Some(1.0));
        assert!(Program::decode(4,&[1.0,2.0]).is_none());
        assert!(Program::decode(1,&[0.0,1.0,10.0,0.0]).is_none());
        assert!(Program::decode(1,&[999.0,0.0]).is_none());
    }
    #[test] fn stack_and_program_budgets_are_enforced_without_loops() {
        assert!(Program::decode(1,&vec![0.0;2*(MAX_INSTRUCTIONS+1)]).is_none());
        assert!(Program::decode(1,&vec![0.0;2*(MAX_STACK+1)]).is_none());
        let p=Program::decode(1,&[0.0,1.0,0.0,0.0,13.0,0.0]).unwrap();
        assert_eq!(p.evaluate(&[0.0;6],&[0.0;25]),Some(0.0));
        assert_eq!(normalize(0,1000.0,&[3.0,10.0,0.0,0.0,0.0,0.0]),3.0);
    }
}
