import test from 'node:test';import assert from 'node:assert/strict';import {emptyReview,validateReview,reviewerPriorityStats,proposalPriorityStanding} from './public/rct-model.mjs';
const review=(...scores)=>({...emptyReview(),reviewers:emptyReview().reviewers.map((v,i)=>({...v,name:'Reviewer '+i,grade:scores[i]??''}))});
test('priority averages count only named reviewers with valid scores and clearing excludes the slot',()=>{
 const r=review('1','3','5');assert.deepEqual(reviewerPriorityStats(r),{count:3,sum:9,average:3});
 r.reviewers[2].grade='';assert.deepEqual(reviewerPriorityStats(r),{count:2,sum:4,average:2});r.reviewers[0].name='';assert.deepEqual(reviewerPriorityStats(r),{count:1,sum:3,average:3});
 r.reviewers[1].grade='';assert.equal(reviewerPriorityStats(r).average,null);
 const cleared=review('1');cleared.reviewers[0]={name:'',grade:'',comments:'Retain this comment'};assert.equal(validateReview(cleared).reviewers[0].comments,'Retain this comment');assert.equal(reviewerPriorityStats(cleared).count,0);
});
test('proposal standings put low means first, share tied ranks and exclude unscored proposals',()=>{
 const records=[{id:'a',review:review('1','2')},{id:'b',review:review('3')},{id:'c',review:review('1','1','2','2')},{id:'d',review:review()}];
 assert.equal(proposalPriorityStanding(records,'a').rank,1);assert.equal(proposalPriorityStanding(records,'c').rank,1);assert.equal(proposalPriorityStanding(records,'a').tied,true);assert.equal(proposalPriorityStanding(records,'b').rank,3);assert.equal(proposalPriorityStanding(records,'b').scored,3);assert.equal(proposalPriorityStanding(records,'d').rank,null);
 records[0].review.reviewers.forEach(v=>v.grade='');assert.equal(proposalPriorityStanding(records,'b').rank,2);assert.equal(proposalPriorityStanding(records,'a').count,0);
});
