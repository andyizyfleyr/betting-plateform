#!/usr/bin/env node
// Sonde ponctuelle Vercel Production : ne journalise ni identifiants ni résultats.
const mode=process.env.HYPERDRIVE_HISTORY_PROBE;
if (!mode) process.exit(0);
if (mode !== 'v1' || process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production' || !process.env.PARTYKIT_SECRET || process.env.PARTYKIT_SECRET.trim().length < 16) {
 console.error('Sonde Hyperdrive refusée : configuration incorrecte.'); process.exit(1);
}
(async()=>{
 const response=await fetch('https://pulse-bet.matiasanauld.workers.dev/internal/hyperdrive/history-v1?fresh=1',{headers:{Authorization:`Bearer ${process.env.PARTYKIT_SECRET.trim()}`},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok) throw Error('unavailable');
 const data=await response.json();
 if(data.version!==1 || !Array.isArray(data.matches) || data.matches.length>240 || data.matches.some(m=>m.status!=='finished')) throw Error('invalid');
 console.log(`Sonde Hyperdrive : connexion authentifiée et lecture vérifiées (${data.matches.length} résultats).`);
})().catch(()=>{console.error('Sonde Hyperdrive échouée : vérifiez le Worker et son secret ; aucun résultat ni secret affiché.');process.exitCode=1});
