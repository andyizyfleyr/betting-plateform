import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { decryptTotp, matchingStep } from "@/lib/totp";

/** Serialize attempts across instances and reject replayed time steps. */
export async function verifySecondFactor(userId: number, code: string, enable = false, newRecoveryHashes: string[] = []): Promise<boolean> {
  return db.transaction(async tx => {
    const res=await tx.execute(sql`SELECT * FROM user_two_factor WHERE user_id=${userId} FOR UPDATE`);
    const row=res.rows[0];
    if(!row || (enable ? row.enabled || !row.pending_until || new Date(String(row.pending_until)).getTime()<Date.now() : !row.enabled)) return false;
    if(row.locked_until && new Date(String(row.locked_until)).getTime()>Date.now()) return false;
    const step=matchingStep(decryptTotp(String(row.secret_ciphertext)),code);
    const recovery = !enable && /^[a-f0-9]{16}$/i.test(code) ? createHash("sha256").update(code.toLowerCase()).digest("hex") : "";
    const hashes = Array.isArray(row.recovery_hashes) ? row.recovery_hashes as string[] : [];
    const recoveryValid = Boolean(recovery && hashes.includes(recovery));
    if(!recoveryValid && (step===null || step <= Number(row.last_step))) {
      await tx.execute(sql`UPDATE user_two_factor SET attempts=attempts+1,
        locked_until=CASE WHEN attempts+1>=5 THEN now()+interval '15 minutes' ELSE NULL END WHERE user_id=${userId}`);
      return false;
    }
    const nextHashes = enable ? newRecoveryHashes : recoveryValid ? hashes.filter(h=>h!==recovery) : hashes;
    await tx.execute(sql`UPDATE user_two_factor SET enabled=true, pending_until=NULL, last_step=${recoveryValid ? Number(row.last_step) : step}, attempts=0, locked_until=NULL, recovery_hashes=${JSON.stringify(nextHashes)}::jsonb WHERE user_id=${userId}`);
    return true;
  });
}
export async function hasSecondFactor(userId: number): Promise<boolean> {
  const r=await db.execute(sql`SELECT enabled FROM user_two_factor WHERE user_id=${userId}`);
  return r.rows[0]?.enabled === true;
}
