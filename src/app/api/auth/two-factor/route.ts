import { randomBytes, createHash } from "crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { verifyPassword } from "@/lib/auth";
import { requireUserId } from "@/lib/session";
import { encryptTotp, generateTotpSecret } from "@/lib/totp";
import { hasSecondFactor, verifySecondFactor } from "@/lib/two-factor";
import { formatServerErrorResponse } from "@/lib/db-error";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(req:NextRequest){try{await ensureSeeded();const uid=await requireUserId(req);if(typeof uid!=="number")return uid;return NextResponse.json({enabled:await hasSecondFactor(uid)},{headers});}catch(e){return formatServerErrorResponse(e,"GET 2FA");}}
export async function POST(req:NextRequest){
 try{await ensureSeeded();const uid=await requireUserId(req);if(typeof uid!=="number")return uid;
 const data=await req.json().catch(()=>null);const action=data?.action;const password=typeof data?.password==='string'?data.password:'';
 const [user]=await db.select().from(appUser).where(eq(appUser.id,uid));
 if(!user?.passwordHash || !verifyPassword(password,user.passwordHash))return NextResponse.json({error:'Mot de passe incorrect.'},{status:401});
 if(action==='setup'){
   if(await hasSecondFactor(uid))return NextResponse.json({error:'Double authentification déjà activée.'},{status:409});
   const secret=generateTotpSecret();const encrypted=encryptTotp(secret);
   await db.execute(sql`INSERT INTO user_two_factor(user_id,secret_ciphertext,pending_until) VALUES (${uid},${encrypted},now()+interval '10 minutes')
     ON CONFLICT(user_id) DO UPDATE SET secret_ciphertext=EXCLUDED.secret_ciphertext,pending_until=EXCLUDED.pending_until,attempts=0,locked_until=NULL WHERE user_two_factor.enabled=false`);
   const label=encodeURIComponent(`Pulse Bet:${user.email||uid}`);
   return NextResponse.json({secret,uri:`otpauth://totp/${label}?secret=${secret}&issuer=Pulse%20Bet&digits=6&period=30`},{headers});
 }
 if(action==='confirm'){
   const recoveryCodes=Array.from({length:8},()=>randomBytes(8).toString("hex"));
   const hashes=recoveryCodes.map(c=>createHash("sha256").update(c).digest("hex"));
   const ok=await verifySecondFactor(uid,String(data?.code||''),true,hashes);
   return ok?NextResponse.json({enabled:true,recoveryCodes},{headers}):NextResponse.json({error:'Code invalide, expiré ou trop de tentatives.'},{status:400});
 }
 if(action==='disable'){
   const ok=await verifySecondFactor(uid,String(data?.code||''));
   if(!ok)return NextResponse.json({error:'Code invalide ou trop de tentatives.'},{status:400});
   await db.execute(sql`DELETE FROM user_two_factor WHERE user_id=${uid}`);
   return NextResponse.json({enabled:false},{headers});
 }
 return NextResponse.json({error:'Action invalide'},{status:400});
 }catch(e){return formatServerErrorResponse(e,'POST 2FA');}
}
