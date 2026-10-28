/** Règle le gain selon les conditions inscrites sur le ticket, jamais les limites actuelles. */
export function settlementPayout(bet: { stake: number; odds: number; potentialWin: number; payoutMultiplier?: number | null; stakeReturned?: number | null }, won: boolean, voided: boolean): number {
  if (voided) return Math.round(bet.stake * 1_000_000) / 1_000_000;
  if (!won) return 0;
  const calculated = bet.stake * bet.odds * (bet.payoutMultiplier ?? 1) + (bet.stakeReturned ?? 0);
  return Math.round(Math.min(bet.potentialWin, calculated) * 1_000_000) / 1_000_000;
}
