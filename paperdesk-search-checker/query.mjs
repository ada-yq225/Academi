import {tokens} from './matcher.mjs';
const stop=new Set('a an the to of in on at by for from with and or but is are was were be been being this that these those it its we our their they as also use used using which can could would should has have had do does did not'.split(' '));
export function queryForSentence(text){
 const words=tokens(text);if(!words.length)return '';
 if(words.filter(t=>/\p{Script=Han}/u.test(t.value)).length>words.length*.25)return text.slice(0,words[Math.min(35,words.length-1)].end);
 if(words.length<=14)return text.slice(0,160);
 const size=12;let best={score:-Infinity,start:0,end:size-1};
 for(let i=0;i<=words.length-size;i++){
  const window=words.slice(i,i+size),score=window.reduce((sum,w)=>sum+(stop.has(w.value)?-2:Math.min(w.value.length,12)),0);
  if(score>best.score)best={score,start:i,end:i+size-1};
 }
 while(best.start<best.end&&stop.has(words[best.start].value))best.start++;
 return text.slice(words[best.start].start,words[best.end].end).slice(0,200);
}
