const C = require('../src/core.js');
C.setNow('2026-09-16T10:00:00'); // Wed
const cases = [
 ['call DEWA tmrw commute ~2m', {title:'Call DEWA', due:'2026-09-17', time:'08:00', slot:'commute', area:'admin', effort:'2m', hard:false}],
 ['dogs flea tick every 30 days after done', {title:'Dogs flea tick', recur:{kind:'float',n:30,unit:'d'}, area:'dogs', due:'2026-09-16'}],
 ['vet for dogs tue 5pm', {title:'Vet for dogs', due:'2026-09-22', time:'17:00', hard:true, area:'dogs'}],
 ['Renew Emirates ID expires 12 mar 2027', {title:'Renew Emirates ID', expiry:{date:'2027-03-12'}, area:'admin', due:null}],
 ['buy dog shampoo from amazon', {title:'Buy dog shampoo', list:'buy', shop:'Amazon', area:'dogs'}],
 ['gift idea for wife: cashmere scarf', {title:'Cashmere scarf', list:'gift', person:'Wife'}],
 ['waiting on Ahmed for pool quote', {title:'Pool quote', list:'waiting', person:'Ahmed', area:'home'}],
 ['learn arabic someday', {title:'Learn arabic', list:'someday', due:null}],
 ['pay rent monthly', {title:'Pay rent', recur:{kind:'fixed',n:1,unit:'m'}, due:'2026-09-16'}],
 ['bins out every mon and thu', {title:'Bins out', recur:{kind:'fixed',n:1,unit:'w',dows:[1,4]}, due:'2026-09-17'}],
 ['service AC every year before summer', {title:'Service AC', recur:{kind:'season',key:'summer'}, due:'2027-05-15', area:'home'}],
 ['book summer flights before ramadan', {title:'Book summer flights', due:'2027-01-25'}],
 ['email recruiter tonight', {title:'Email recruiter', due:'2026-09-16', slot:'night', time:'20:00', area:'work'}],
 ['haircut this weekend', {title:'Haircut', due:'2026-09-19', slot:'morning', time:'09:00', area:'me'}],
 ['meeting prep at 14:30 !', {title:'Meeting prep', time:'14:30', due:'2026-09-16', hard:true}],
 ['call mum at 9am', {title:'Call mum', time:'09:00', due:'2026-09-17', hard:true}],
 ['buy sun cream', {title:'Buy sun cream', due:null, list:'buy'}],
 ['book George paediatrician next tue', {title:'Book George paediatrician', due:'2026-09-22', area:'george'}],
 ['check car tyres in 2 weeks', {title:'Check car tyres', due:'2026-09-30', area:'car'}],
 ['passport expires in 6 months', {title:'Passport', expiry:{date:'2027-03-16'}}],
 ['renew car registration expires 3/2/27', {title:'Renew car registration', expiry:{date:'2027-02-03'}, area:'car'}],
 ['draft board memo by friday', {title:'Draft board memo', due:'2026-09-18', effort:'deep', area:'work'}],
 ['text builder when home', {title:'Text builder', due:'2026-09-16', slot:'home', time:'17:30'}],
 ['water filter every 3 months after done #home', {area:'home', recur:{kind:'float',n:3,unit:'m'}, title:'Water filter'}],
 ['remind me to call bank on 1 oct at 11', {title:'Call bank', due:'2026-10-01', time:'11:00', hard:true, area:'admin'}],
 ['groom dogs every 6 weeks', {recur:{kind:'fixed',n:6,unit:'w'}}],
 ['order nappies on noon', {list:'buy', shop:'Noon', area:'george', title:'Order nappies'}],
 ['swim with George sat morning', {due:'2026-09-19'}],
 ['sit in the sun with a book', {due:null}],
 ['buy summer shirts', {due:null, list:'buy'}],
 ['swim with George on sat morning', {due:'2026-09-19', slot:'morning'}],
 ['Passport expires 3/27', {title:'Passport', expiry:{date:'2027-03-01'}}],
 ['renew car insurance expires in 20 days', {area:'car', expiry:{date:'2026-10-06'}}],
 ['team offsite end of month', {due:'2026-09-30', area:'work'}],
 ['backup photos every weekday', {recur:{kind:'fixed',n:1,unit:'w',dows:[1,2,3,4,5]}}],
];
let fail=0;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
for (const [inp, exp] of cases) {
  const r = C.parse(inp);
  const bad = [];
  for (const k in exp) {
    let got = r[k];
    if (exp[k] && typeof exp[k]==='object' && got) { const g={}; for(const kk in exp[k]) g[kk]=got[kk]; got=g; }
    if (!eq(got, exp[k])) bad.push(`${k}: got ${JSON.stringify(r[k])} want ${JSON.stringify(exp[k])}`);
  }
  if (bad.length) { fail++; console.log('FAIL', inp, '\n   ', bad.join('\n    ')); }
}
console.log(`${cases.length-fail}/${cases.length} passed`);
