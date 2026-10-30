const assert = require('node:assert/strict');
const WebSocket = require('ws');
const base = process.env.PARTY_TEST_URL || 'http://127.0.0.1:8787';
const url = base.replace(/^http/, 'ws') + '/parties/main/live-matches';
function connect() {
  const socket = new WebSocket(url);
  const queue = [], waiting = [];
  socket.on('message', raw => { const item=JSON.parse(String(raw)); const w=waiting.shift(); if(w) w(item); else queue.push(item); });
  return {socket, next: () => new Promise((resolve,reject) => {
    if(queue.length) return resolve(queue.shift());
    const timer=setTimeout(()=>reject(new Error('message timeout')),3000);
    waiting.push(item=>{clearTimeout(timer);resolve(item);});
  })};
}
async function sendSnapshot(matches) {
  const res = await fetch(base+'/parties/main/live-matches', {method:'POST',headers:{Authorization:'Bearer pulse-bet-dev-partykit-secret','Content-Type':'application/json'}, body:JSON.stringify({type:'MATCHES_SNAPSHOT',matches,serverTime:'2026-01-01T00:00:00Z'})});
  assert.equal(res.status,200, await res.text());
}
(async()=>{
 const first=Array.from({length:50},(_,i)=>({id:i+1,odds:2,league:'Test long league name'}));
 // Une copie initiale avant la connexion fournit un accusé de négociation
 // séquencé : l'envoi HTTP ne court plus contre le message WebSocket.
 await sendSnapshot(first);
 const a=connect(), b=connect();
 try {
   const [old1, initial]=await Promise.all([a.next(), b.next()]);
   assert.equal(old1.type,'MATCHES_SNAPSHOT'); assert.equal(initial.type,'MATCHES_SNAPSHOT');
   b.socket.send(JSON.stringify({type:'LIVE_DELTA_V1'}));
   const new1=await b.next();
   assert.equal(new1.type,'MATCHES_SNAPSHOT'); assert.equal(typeof new1.seq,'number');
   const second=first.map(m=>m.id===1?{...m,odds:3}:m).filter(m=>m.id!==2);
   await sendSnapshot(second);
   const [old2,new2]=await Promise.all([a.next(),b.next()]);
   assert.equal(old2.type,'MATCHES_SNAPSHOT'); assert.equal(old2.matches.length,49);
   assert.equal(new2.type,'MATCHES_DELTA'); assert.equal(new2.matches.length,1); assert.equal(new2.base,new1.seq); assert(!new2.order.includes(2));
   b.socket.send(JSON.stringify({type:'LIVE_RESYNC_V1'}));
   const resync=await b.next(); assert.equal(resync.type,'MATCHES_SNAPSHOT'); assert.equal(resync.seq,new2.seq); assert.equal(resync.matches.length,49);
   console.log('Worker local : ancienne APK, négociation delta, suppression et resynchronisation OK.');
 } finally { a.socket.close(); b.socket.close(); }
})().catch(e=>{console.error(e); process.exitCode=1;});
