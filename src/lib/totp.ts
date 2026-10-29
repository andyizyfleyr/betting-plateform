import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(data: Buffer): string {
  let bits=0, value=0, result="";
  for (const b of data) { value=(value << 8)|b; bits+=8; while(bits>=5){result+=alphabet[(value >>> (bits-5))&31]; bits-=5;} }
  if(bits) result+=alphabet[(value << (5-bits))&31]; return result;
}
export function decodeBase32(input: string): Buffer {
  let value=0,bits=0; const out:number[]=[];
  for(const char of input.replace(/=+$/,'').toUpperCase()) { const n=alphabet.indexOf(char); if(n<0)throw new Error('Clé invalide'); value=(value << 5)|n; bits+=5; if(bits>=8){out.push((value >>> (bits-8))&255);bits-=8;} }
  return Buffer.from(out);
}
export function totpAt(secret: string, counter: number): string {
  const buffer=Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const hash=createHmac('sha1',decodeBase32(secret)).update(buffer).digest();
  const offset=hash[hash.length-1]&15; return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export function matchingStep(secret: string, code: string, timestamp=Date.now()): number | null {
  if(!/^\d{6}$/.test(code))return null; const now=Math.floor(timestamp/30000);
  for(const step of [now,now-1,now+1]) { const a=Buffer.from(totpAt(secret,step));const b=Buffer.from(code); if(timingSafeEqual(a,b))return step; } return null;
}
function key(): Buffer { const k=process.env.TOTP_ENCRYPTION_KEY || ''; if(!/^[0-9a-fA-F]{64}$/.test(k))throw new Error('TOTP_ENCRYPTION_KEY non configurée'); return Buffer.from(k,'hex'); }
export function encryptTotp(secret: string): string { const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.'); }
export function decryptTotp(payload: string): string { const [iv,tag,data]=payload.split('.').map(x=>Buffer.from(x,'base64url'));const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'); }
export function generateTotpSecret(): string { return base32(randomBytes(20)); }
