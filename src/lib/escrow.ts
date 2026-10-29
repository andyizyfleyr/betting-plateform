import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Only called after authentication and server-side conversion into 6-decimal EUR. */
export async function createEscrow(senderId: number, recipientId: number, amountEur: string, key: string) {
  if (!Number.isSafeInteger(senderId) || !Number.isSafeInteger(recipientId) || senderId <= 0 || recipientId <= 0 || senderId === recipientId || !/^(?:0|[1-9]\d{0,6})\.\d{6}$/.test(amountEur) || !/^[A-Za-z0-9_-]{8,120}$/.test(key)) throw new Error("Paramètres invalides");
  if (Number(amountEur) <= 0 || Number(amountEur) > 5000) throw new Error("Montant invalide");
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    const sender=await tx.execute(sql`SELECT id, balance, bonus_locked FROM app_user WHERE id=${senderId} FOR UPDATE`);
    if (!sender.rows.length) throw new Error("Compte introuvable");
    const existing=await tx.execute(sql`SELECT *, amount_eur::text AS amount_text FROM escrow_transfers WHERE sender_id=${senderId} AND idempotency_key=${key}`);
    if(existing.rows.length){const e=existing.rows[0];if(Number(e.recipient_id)!==recipientId || e.amount_text!==amountEur)throw new Error("Clé d'idempotence déjà utilisée");return {...e,deduplicated:true};}
    const recipient=await tx.execute(sql`SELECT id FROM app_user WHERE id=${recipientId} AND role <> 'admin'`);
    if(!recipient.rows.length)throw new Error("Destinataire introuvable");
    // On protège l'intégralité du bonus tant que son déblocage n'est pas vérifié sous le verrou.
    const debit=await tx.execute(sql`UPDATE app_user SET balance=ROUND((balance::numeric-${amountEur}::numeric),6)::float8
      WHERE id=${senderId} AND balance::numeric - GREATEST(bonus_locked::numeric,0) >= ${amountEur}::numeric RETURNING id`);
    if(!debit.rows.length)throw new Error("Solde transférable insuffisant");
    const created=await tx.execute(sql`INSERT INTO escrow_transfers(sender_id,recipient_id,amount_eur,state,idempotency_key)
      VALUES (${senderId},${recipientId},${amountEur}::numeric,'held',${key}) RETURNING *`);
    const e=created.rows[0];
    await tx.execute(sql`INSERT INTO escrow_actions(escrow_id,actor_id,action) VALUES (${Number(e.id)},${senderId},'create')`);
    return e;
  });
}
export type EscrowAction = 'accept' | 'decline' | 'cancel' | 'release' | 'dispute';
export async function actOnEscrow(userId:number, id:number, action:EscrowAction) {
  if(!Number.isSafeInteger(userId) || !Number.isSafeInteger(id) || id<=0 || !['accept','decline','cancel','release','dispute'].includes(action))throw new Error('Paramètres invalides');
  return db.transaction(async tx=>{
    await tx.execute(sql`SET LOCAL lock_timeout = '2500ms'`);
    const result=await tx.execute(sql`SELECT *, amount_eur::text AS amount_text FROM escrow_transfers WHERE id=${id} FOR UPDATE`);
    const e=result.rows[0]; if(!e || (Number(e.sender_id)!==userId && Number(e.recipient_id)!==userId))throw new Error('Séquestre introuvable');
    const sender=Number(e.sender_id), recipient=Number(e.recipient_id), state=String(e.state);
    let next: string | null = null, credit: number | null = null;
    if(action==='accept' && userId===recipient && state==='held') next='accepted';
    if(action==='decline' && userId===recipient && (state==='held' || state==='accepted')) {next='refunded';credit=sender;}
    if(action==='cancel' && userId===sender && state==='held') {next='refunded';credit=sender;}
    if(action==='release' && userId===sender && state==='accepted') {next='released';credit=recipient;}
    if(action==='dispute' && (state==='held' || state==='accepted'))next='disputed';
    if(!next)throw new Error('Action non autorisée ou séquestre déjà traité');
    if(credit!==null){
      const update=await tx.execute(sql`UPDATE app_user SET balance=ROUND((balance::numeric+${String(e.amount_text)}::numeric),6)::float8 WHERE id=${credit} RETURNING id`);
      if(!update.rows.length)throw new Error('Compte bénéficiaire introuvable');
    }
    const updated=await tx.execute(sql`UPDATE escrow_transfers SET state=${next},updated_at=now() WHERE id=${id} RETURNING *`);
    await tx.execute(sql`INSERT INTO escrow_actions(escrow_id,actor_id,action) VALUES (${id},${userId},${action})`);
    return updated.rows[0];
  });
}
