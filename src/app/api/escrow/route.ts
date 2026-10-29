import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { appUser } from "@/db/schema";
import { requireUserId } from "@/lib/session";
import { formatServerErrorResponse } from "@/lib/db-error";
import { verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrencyConfig, localToEur, roundEurPivot } from "@/lib/countries";
import { actOnEscrow, createEscrow, type EscrowAction } from "@/lib/escrow";
import { invalidateUserCaches } from "@/lib/active-state-cache";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
function disabled(){return NextResponse.json({error:"Le séquestre n'est pas encore activé."},{status:503,headers});}
async function auth(req:NextRequest){await ensureSeeded();return requireUserId(req);}
export async function GET(req:NextRequest){
 try {if(process.env.ESCROW_ENABLED!=="true")return disabled();const uid=await auth(req);if(typeof uid!=="number")return uid;
  const result=await db.execute(sql`SELECT e.id,e.sender_id,e.recipient_id,e.amount_eur::text,e.state,e.created_at,e.updated_at,s.name AS sender_name,r.name AS recipient_name
    FROM escrow_transfers e JOIN app_user s ON s.id=e.sender_id JOIN app_user r ON r.id=e.recipient_id
    WHERE e.sender_id=${uid} OR e.recipient_id=${uid} ORDER BY e.id DESC LIMIT 100`);
  return NextResponse.json({transfers:result.rows},{headers});
 }catch(e){return formatServerErrorResponse(e,'GET escrow');}
}
export async function POST(req:NextRequest){
 try {if(process.env.ESCROW_ENABLED!=="true")return disabled();const uid=await auth(req);if(typeof uid!=="number")return uid;
  if(!checkRateLimit(`escrow:${uid}`,10,60000).allowed)return NextResponse.json({error:'Trop de tentatives.'},{status:429});
  const body=await req.json().catch(()=>null);const [u]=await db.select({id:appUser.id,passwordHash:appUser.passwordHash,currency:appUser.currency}).from(appUser).where(eq(appUser.id,uid));
  if(!u?.passwordHash || !verifyPassword(typeof body?.password==='string'?body.password:'',u.passwordHash))return NextResponse.json({error:'Mot de passe incorrect.'},{status:401});
  if(body?.action==='create'){
   const local=Number(body.amount);const currency=getCurrencyConfig(u.currency);const id=Number(body.recipientId);const key=typeof body.idempotencyKey==='string'?body.idempotencyKey:'';
   if(!Number.isFinite(local)||local<=0||local>currency.maxWithdrawalLocal)return NextResponse.json({error:'Montant invalide.'},{status:400});
   const amount=roundEurPivot(localToEur(local,currency.code));
   if(!Number.isFinite(amount)||amount<=0||amount>5000)return NextResponse.json({error:'Montant invalide.'},{status:400});
   const escrow=await createEscrow(uid,id,amount.toFixed(6),key);invalidateUserCaches([uid]);return NextResponse.json({transfer:escrow},{headers});
  }
  const action=String(body?.action||'') as EscrowAction;const id=Number(body?.id);const result=await actOnEscrow(uid,id,action);
  invalidateUserCaches([Number(result.sender_id),Number(result.recipient_id)]);return NextResponse.json({transfer:result},{headers});
 } catch(e){
   if(e instanceof Error && /^(Paramètres invalides|Montant invalide|Compte introuvable|Destinataire introuvable|Solde transférable insuffisant|Clé d'idempotence déjà utilisée|Séquestre introuvable|Action non autorisée ou séquestre déjà traité)$/.test(e.message))return NextResponse.json({error:e.message},{status:409,headers});
   return formatServerErrorResponse(e,'POST escrow');
 }
}
