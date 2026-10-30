const assert=require('node:assert/strict');
const {NextRequest}=require('next/server');
const meta=require('../src/lib/expo-sdk52-meta.json');
const {GET}=require('../src/app/api/expo/route.ts');
(async()=>{
 const request=()=>new NextRequest('https://app.example.com/api/expo?platform=android&format=json',{headers:{host:'app.example.com','expo-runtime-version':'pulse-sdk52-v1','expo-protocol-version':'1'}});
 delete process.env.R2_OTA_ASSETS_ORIGIN;
 const first=await GET(request());assert.equal(first.status,200); const before=await first.json();assert.equal(before.launchAsset.url,'https://app.example.com'+meta.launchAsset.relativePath);
 process.env.R2_OTA_ASSETS_ORIGIN='https://cdn.example.com';
 const second=await GET(request());assert.equal(second.status,200);const after=await second.json();assert.equal(after.launchAsset.url,'https://cdn.example.com'+meta.launchAsset.relativePath);
 assert.equal(after.runtimeVersion,'pulse-sdk52-v1');assert.equal(after.id,before.id);assert.equal(after.launchAsset.hash,before.launchAsset.hash);
 assert.deepEqual(after.assets.map(a=>a.hash),before.assets.map(a=>a.hash));assert(after.assets.every(a=>a.url.startsWith('https://cdn.example.com/expo-sdk52/assets/')));
 process.env.R2_OTA_ASSETS_ORIGIN='http://bad.example';const fallback=await (await GET(request())).json();assert.equal(fallback.launchAsset.url,before.launchAsset.url);
 console.log('OTA : manifeste SDK52, empreintes et repli sans R2 vérifiés.');
})().catch(e=>{console.error(e);process.exitCode=1});
