import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Layers,
  RotateCcw,
  Share2,
  TrendingUp,
  X,
} from "lucide-react-native";
import { useApp } from "@/context/app-context";
import {
  api,
  ApiHttpError,
  CASHOUT_CHANGED_CODE,
  generateIdempotencyKey,
  type BetStatus,
  type CashoutChangedDetails,
  type ClientBet,
  type ClientComboLeg,
} from "@/lib/api";
import { sortComboBetLegsChronologically } from "@/lib/combo-math";
import { eur, formatKickoff, formatOdds, formatPlacedAt } from "@/lib/format";
import type { LiveClockSource } from "@/lib/live-clock";
import { useRouter } from "@/lib/router";
import { COLORS, triggerHaptic } from "@/theme/tokens";
import { LiveMatchClock } from "./live-match-clock";
import { SlideToCashOut } from "./slide-to-cashout";
import { SportIcon } from "./sport-icon";
import { TeamAvatar } from "./team-avatar";

export function shortMarketBadge(market: string): string | null {
  switch (market) {
    case "result":
    case "1x2":
      return "1X2";
    case "double":
    case "double_chance":
      return "DC";
    case "btts":
      return "BTTS";
    case "ou15":
      return "T 1.5";
    case "ou25":
    case "over_under_25":
    case "total_25":
    case "total_ou":
      return "Total";
    case "ou35":
      return "T 3.5";
    case "dnb":
      return "DNB";
    case "score_exact":
      return "Score";
    case "yesno":
      return "Oui/Non";
    case "multichoice":
      return "Choix";
    default:
      return null;
  }
}

export function resolveLegTeams(
  leg: ClientComboLeg
): {
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
} | null {
  if (leg.kind !== "sport") return null;
  if (leg.homeTeam && leg.awayTeam) {
    return {
      home: leg.homeTeam,
      away: leg.awayTeam,
      homeLogo: leg.homeLogo ?? null,
      awayLogo: leg.awayLogo ?? null,
    };
  }
  for (const sep of [" – ", " - ", " vs "]) {
    if (leg.title.includes(sep)) {
      const [h, a] = leg.title.split(sep).map((s) => s.trim());
      if (h && a) {
        return {
          home: h,
          away: a,
          homeLogo: leg.homeLogo ?? null,
          awayLogo: leg.awayLogo ?? null,
        };
      }
    }
  }
  return null;
}

export function singleBetHref(bet: Pick<ClientBet, "id" | "kind">): string {
  return bet.kind === "prediction"
    ? `/paris/simple/pred-${bet.id}`
    : `/paris/simple/sport-${bet.id}`;
}

export function StatusPill({
  status,
  live = false,
  minute,
  clockSource,
}: {
  status: BetStatus;
  live?: boolean;
  minute?: string | null;
  clockSource?: LiveClockSource | null;
}) {
  if (status === "won") {
    return (
      <View style={[styles.statusPill, styles.statusWon]}>
        <Check size={10} color={COLORS.win} strokeWidth={3} />
        <Text style={[styles.statusText, { color: COLORS.win }]}>Gagné</Text>
      </View>
    );
  }
  if (status === "lost") {
    return (
      <View style={[styles.statusPill, styles.statusLost]}>
        <X size={10} color={COLORS.betclicRed} strokeWidth={3} />
        <Text style={[styles.statusText, { color: COLORS.betclicRed }]}>
          Perdu
        </Text>
      </View>
    );
  }
  if (status === "cashed") {
    return (
      <View style={[styles.statusPill, styles.statusCashed]}>
        <Text style={[styles.statusText, { color: "#0369a1" }]}>Vendu</Text>
      </View>
    );
  }
  if (status === "void") {
    return (
      <View style={[styles.statusPill, styles.statusVoid]}>
        <RotateCcw size={10} color="#92400e" strokeWidth={2.5} />
        <Text style={[styles.statusText, { color: "#92400e" }]}>Remboursé</Text>
      </View>
    );
  }
  if (live) {
    return (
      <View style={[styles.statusPill, styles.statusLost]}>
        <View style={styles.liveDot} />
        <LiveMatchClock
          match={clockSource}
          fallback={minute ?? "LIVE"}
          prefix="Direct "
          style={[styles.statusText, { color: COLORS.betclicRed }]}
        />
      </View>
    );
  }
  return (
    <View style={[styles.statusPill, styles.statusPending]}>
      <Text style={[styles.statusText, { color: COLORS.ink }]}>En cours</Text>
    </View>
  );
}

export const BetStatusBadge = StatusPill;

export function TicketTeamRow({
  name,
  logo,
  score,
  winner,
  isLive,
  isFinished,
}: {
  name: string;
  logo?: string | null;
  score: number | null;
  winner?: boolean;
  isLive?: boolean;
  isFinished?: boolean;
}) {
  return (
    <View style={styles.ticketTeamRow}>
      <TeamAvatar name={name} logo={logo} size="xs" />
      <Text
        numberOfLines={1}
        style={[
          styles.ticketTeamName,
          isFinished && !winner ? { color: COLORS.mist } : { color: COLORS.ink },
        ]}
      >
        {name}
      </Text>
      {score != null ? (
        <View
          style={[
            styles.ticketScorePill,
            isLive
              ? { backgroundColor: "rgba(225, 0, 20, 0.10)" }
              : isFinished && winner
                ? { backgroundColor: COLORS.elev }
                : null,
          ]}
        >
          <Text
            style={[
              styles.ticketScoreText,
              isLive
                ? { color: COLORS.betclicRed }
                : isFinished && winner
                  ? { color: COLORS.ink }
                  : { color: COLORS.mist },
            ]}
          >
            {score}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Amount({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "win" | "lost" | "cash" | "pot";
}) {
  const color =
    tone === "win"
      ? COLORS.win
      : tone === "lost"
        ? COLORS.betclicRed
        : tone === "cash"
          ? "#0369a1"
          : COLORS.ink;
  return (
    <View style={styles.amountInline}>
      <Text style={styles.amountLabel}>{label} :</Text>
      <Text style={[styles.amountVal, { color }]}>{value}</Text>
    </View>
  );
}

function LegMiniStatus({
  leg,
  live,
}: {
  leg: ClientComboLeg;
  live: boolean;
}) {
  if (leg.status === "won") {
    return (
      <View style={[styles.miniStatusCircle, { backgroundColor: COLORS.win }]}>
        <Check size={10} color="#ffffff" strokeWidth={3} />
      </View>
    );
  }
  if (leg.status === "lost") {
    return (
      <View
        style={[styles.miniStatusCircle, { backgroundColor: COLORS.betclicRed }]}
      >
        <X size={10} color="#ffffff" strokeWidth={3} />
      </View>
    );
  }
  if (leg.status === "void") {
    return (
      <View
        style={[
          styles.miniStatusCircle,
          { backgroundColor: "rgba(245,158,11,0.2)" },
        ]}
      >
        <RotateCcw size={10} color="#92400e" strokeWidth={2.6} />
      </View>
    );
  }
  if (live) {
    return (
      <View
        style={[
          styles.miniStatusCircle,
          { backgroundColor: "rgba(225,0,20,0.12)" },
        ]}
      >
        <View style={styles.liveDot} />
      </View>
    );
  }
  return <View style={styles.miniPendingDot} />;
}

export function BetTicket({
  bet,
  onShare,
  onCashedOut,
}: {
  bet: ClientBet;
  onShare?: (bet: ClientBet) => void;
  onCashedOut?: () => void;
}) {
  if (bet.kind === "combo" && bet.legs && bet.legs.length > 0) {
    return (
      <ComboBetTicket
        bet={bet}
        legs={bet.legs}
        onShare={onShare}
        onCashedOut={onCashedOut}
      />
    );
  }
  return (
    <SingleBetTicket bet={bet} onShare={onShare} onCashedOut={onCashedOut} />
  );
}

function ComboBetTicket({
  bet,
  legs,
  onShare,
  onCashedOut,
}: {
  bet: ClientBet;
  legs: ClientComboLeg[];
  onShare?: (bet: ClientBet) => void;
  onCashedOut?: () => void;
}) {
  const router = useRouter();
  const { oddsFormat, setBalance, bumpBets, openShareTicket, toast, hapticsEnabled } =
    useApp();
  const [cashing, setCashing] = useState(false);
  const [cashoutChanged, setCashoutChanged] =
    useState<CashoutChangedDetails | null>(null);
  const [serverOverrideCashout, setServerOverrideCashout] = useState<
    number | null
  >(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    if (serverOverrideCashout == null) return;
    const t = setTimeout(() => setServerOverrideCashout(null), 10_000);
    return () => clearTimeout(t);
  }, [serverOverrideCashout]);

  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";

  const effectiveCashOut =
    bet.cashOut != null
      ? serverOverrideCashout ?? Math.round(bet.cashOut * 100) / 100
      : null;
  const canCashOut =
    bet.status === "pending" && effectiveCashOut != null && effectiveCashOut > 0;

  const sortedLegs = useMemo(
    () => sortComboBetLegsChronologically(legs),
    [legs]
  );
  const totalLegs = sortedLegs.length;
  const wonCount = sortedLegs.filter((l) => l.status === "won").length;
  const lostCount = sortedLegs.filter((l) => l.status === "lost").length;
  const liveCount = sortedLegs.filter(
    (l) => l.status === "pending" && l.matchStatus === "live"
  ).length;
  const anyLive =
    bet.status === "pending" && (liveCount > 0 || bet.matchStatus === "live");

  const previewLegs = sortedLegs.slice(0, 2);
  const extraCount = Math.max(0, totalLegs - previewLegs.length);

  const progressSummary = (() => {
    if (won) return `${totalLegs}/${totalLegs} sélections validées`;
    if (cashed) {
      return `Vendu · ${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""}`;
    }
    if (voided) return "Combiné remboursé";
    if (lost) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${lostCount} perdue${lostCount > 1 ? "s" : ""}`;
    }
    if (liveCount > 0) {
      return `${wonCount}/${totalLegs} validée${wonCount > 1 ? "s" : ""} · ${liveCount} en direct`;
    }
    return `${wonCount}/${totalLegs} sélection${totalLegs > 1 ? "s" : ""} validée${wonCount > 1 ? "s" : ""}`;
  })();

  const doCashOut = async () => {
    if (cashing || inFlightRef.current || effectiveCashOut == null) return;
    inFlightRef.current = true;
    const sig = `combo:${bet.id}:${effectiveCashOut}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("co"),
        sig,
      };
    }
    setCashing(true);
    try {
      const r = await api.cashOut({
        betId: bet.id,
        kind: "combo",
        expectedCashout: effectiveCashOut,
        idempotencyKey: idempotencySlotRef.current.key,
      });
      idempotencySlotRef.current = null;
      setCashoutChanged(null);
      setServerOverrideCashout(null);
      setBalance(r.balance);
      bumpBets();
      onCashedOut?.();
      triggerHaptic("success", hapticsEnabled);
      toast({
        kind: "success",
        title: "Coupon vendu",
        description: `+${eur(r.value)} crédités sur votre solde`,
      });
    } catch (e) {
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      if (
        e instanceof ApiHttpError &&
        e.status === 409 &&
        e.code === CASHOUT_CHANGED_CODE &&
        e.cashoutDetails
      ) {
        setCashoutChanged(e.cashoutDetails);
        setServerOverrideCashout(e.cashoutDetails.currentCashout);
        bumpBets();
        return;
      }
      setCashoutChanged(null);
      toast({
        kind: "error",
        title: "Vente du coupon impossible",
        description:
          e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      inFlightRef.current = false;
      setCashing(false);
    }
  };

  return (
    <View
      style={[
        styles.card,
        won && styles.cardWon,
        lost && styles.cardLost,
      ]}
    >
      {/* En-tête */}
      <View style={styles.headRow}>
        <Pressable
          onPress={() => router.push(`/paris/combine/${bet.id}`)}
          style={styles.headLeft}
        >
          <Layers size={14} color={COLORS.betclicRed} strokeWidth={2.3} />
          <Text style={styles.comboLabel}>Combiné</Text>
          {bet.boostPct != null && bet.boostPct > 0 ? (
            <View style={styles.boostMiniBadge}>
              <Text style={styles.boostMiniText}>+{bet.boostPct}%</Text>
            </View>
          ) : null}
          <Text style={styles.dot}>·</Text>
          <Text numberOfLines={1} style={styles.dateText}>
            {formatPlacedAt(
              bet.status !== "pending"
                ? (bet.settledAt ?? bet.placedAt)
                : bet.placedAt
            )}
          </Text>
        </Pressable>

        <View style={styles.headRight}>
          <Pressable
            onPress={() => (onShare ? onShare(bet) : openShareTicket(bet))}
            style={styles.flexPill}
          >
            <Share2 size={12} color={COLORS.mist} strokeWidth={2.2} />
            <Text style={styles.flexText}>Flex</Text>
          </Pressable>
          <StatusPill
            status={bet.status}
            live={Boolean(anyLive)}
            minute={bet.matchMinute}
            clockSource={
              anyLive
                ? (() => {
                    const liveLeg = legs.find(
                      (l) => l.status === "pending" && l.matchStatus === "live"
                    );
                    return {
                      matchId: bet.liveMatchId ?? liveLeg?.matchId ?? null,
                      status: "live",
                      minute: bet.matchMinute ?? liveLeg?.matchMinute ?? null,
                      startsAt:
                        bet.liveMatchStartsAt ?? liveLeg?.matchStartsAt ?? null,
                      source:
                        bet.liveMatchSource ?? liveLeg?.matchSource ?? null,
                      clockAnchor:
                        bet.matchClockAnchor ?? liveLeg?.matchClockAnchor ?? null,
                    };
                  })()
                : null
            }
          />
        </View>
      </View>

      <Pressable onPress={() => router.push(`/paris/combine/${bet.id}`)}>
        {/* Aperçu 2 sélections + barre Détails */}
        <View style={styles.bodyWrap}>
          <View style={styles.previewRow}>
            <View style={{ flex: 1, gap: 6 }}>
              {previewLegs.map((leg, idx) => {
                const teams = resolveLegTeams(leg);
                const legLive =
                  leg.status === "pending" && leg.matchStatus === "live";
                const titleText = teams
                  ? `${teams.home} – ${teams.away}`
                  : leg.title;
                return (
                  <View key={idx} style={styles.previewLegRow}>
                    <View style={styles.previewLegLeft}>
                      <LegMiniStatus leg={leg} live={legLive} />
                      {teams ? (
                        <TeamAvatar
                          name={teams.home}
                          logo={leg.homeLogo}
                          size="2xs"
                        />
                      ) : (
                        <TrendingUp
                          size={14}
                          color={COLORS.betclicRed}
                          strokeWidth={2.2}
                        />
                      )}
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.previewLegTitle,
                          leg.status === "lost" && styles.lineThroughMist,
                        ]}
                      >
                        {titleText}
                      </Text>
                    </View>
                    <Text style={styles.previewLegOdds}>
                      {formatOdds(leg.odds, oddsFormat)}
                    </Text>
                  </View>
                );
              })}
            </View>
            <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
          </View>

          <View style={styles.selectionBar}>
            <Text numberOfLines={1} style={styles.selectionBarText}>
              {progressSummary}
              {extraCount > 0
                ? ` · +${extraCount} autre${extraCount > 1 ? "s" : ""}`
                : ""}
            </Text>
            <View style={styles.detailsInline}>
              <Text style={styles.detailsText}>Détails</Text>
              <ChevronRight
                size={14}
                color={COLORS.betclicRed}
                strokeWidth={2.5}
              />
            </View>
          </View>
        </View>

        {/* Montants en ligne */}
        <View style={styles.amountsRow}>
          <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
          <Amount
            label="Cote"
            value={`×${formatOdds(bet.odds, oddsFormat)}`}
            tone="neutral"
          />
          {won ? (
            <Amount
              label="Gain reçu"
              value={`+${eur(bet.potentialWin)}`}
              tone="win"
            />
          ) : lost ? (
            <Amount
              label="Résultat"
              value={`-${eur(bet.stake)}`}
              tone="lost"
            />
          ) : cashed ? (
            <Amount
              label="Vendu pour"
              value={`+${eur(bet.cashOutAmount ?? 0)}`}
              tone="cash"
            />
          ) : voided ? (
            <Amount
              label="Remboursé"
              value={`+${eur(bet.stake)}`}
              tone="neutral"
            />
          ) : (
            <Amount
              label="Gain max"
              value={eur(bet.potentialWin)}
              tone="pot"
            />
          )}
        </View>
      </Pressable>

      {canCashOut ? (
        <View style={styles.cashoutSection}>
          {cashoutChanged ? (
            <View style={styles.cashoutAlert}>
              <AlertTriangle size={14} color="#b45309" strokeWidth={2.3} />
              <Text style={styles.cashoutAlertText}>
                Montant mis à jour : {eur(cashoutChanged.previousCashout)} →{" "}
                {eur(cashoutChanged.currentCashout)}. Confirmez à nouveau.
              </Text>
            </View>
          ) : null}
          <SlideToCashOut
            amount={effectiveCashOut!}
            stake={bet.stake}
            loading={cashing}
            onConfirm={doCashOut}
          />
        </View>
      ) : null}
    </View>
  );
}

function SingleBetTicket({
  bet,
  onShare,
  onCashedOut,
}: {
  bet: ClientBet;
  onShare?: (bet: ClientBet) => void;
  onCashedOut?: () => void;
}) {
  const router = useRouter();
  const { oddsFormat, setBalance, bumpBets, openShareTicket, toast, hapticsEnabled } =
    useApp();
  const detailHref = singleBetHref(bet);

  const [cashing, setCashing] = useState(false);
  const [cashoutChanged, setCashoutChanged] =
    useState<CashoutChangedDetails | null>(null);
  const [serverOverrideCashout, setServerOverrideCashout] = useState<
    number | null
  >(null);
  const inFlightRef = useRef(false);
  const idempotencySlotRef = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    if (serverOverrideCashout == null) return;
    const t = setTimeout(() => setServerOverrideCashout(null), 10_000);
    return () => clearTimeout(t);
  }, [serverOverrideCashout]);

  const isPrediction = bet.kind === "prediction";
  const won = bet.status === "won";
  const lost = bet.status === "lost";
  const cashed = bet.status === "cashed";
  const voided = bet.status === "void";
  const live = bet.matchStatus === "live" && bet.status === "pending";

  const effectiveCashOut =
    bet.cashOut != null
      ? serverOverrideCashout ?? Math.round(bet.cashOut * 100) / 100
      : null;
  const canCashOut =
    bet.status === "pending" && effectiveCashOut != null && effectiveCashOut > 0;

  const doCashOut = async () => {
    if (cashing || inFlightRef.current || effectiveCashOut == null) return;
    inFlightRef.current = true;
    const sig = `${bet.kind ?? "sport"}:${bet.id}:${effectiveCashOut}`;
    if (!idempotencySlotRef.current || idempotencySlotRef.current.sig !== sig) {
      idempotencySlotRef.current = {
        key: generateIdempotencyKey("co"),
        sig,
      };
    }
    setCashing(true);
    try {
      const r = await api.cashOut({
        betId: bet.id,
        kind: bet.kind,
        expectedCashout: effectiveCashOut,
        idempotencyKey: idempotencySlotRef.current.key,
      });
      idempotencySlotRef.current = null;
      setCashoutChanged(null);
      setServerOverrideCashout(null);
      setBalance(r.balance);
      bumpBets();
      onCashedOut?.();
      triggerHaptic("success", hapticsEnabled);
      toast({
        kind: "success",
        title: "Coupon vendu",
        description: `+${eur(r.value)} crédités sur votre solde`,
      });
    } catch (e) {
      if (e instanceof ApiHttpError && e.status >= 400 && e.status < 500) {
        idempotencySlotRef.current = null;
      }
      if (
        e instanceof ApiHttpError &&
        e.status === 409 &&
        e.code === CASHOUT_CHANGED_CODE &&
        e.cashoutDetails
      ) {
        setCashoutChanged(e.cashoutDetails);
        setServerOverrideCashout(e.cashoutDetails.currentCashout);
        bumpBets();
        return;
      }
      setCashoutChanged(null);
      toast({
        kind: "error",
        title: "Vente du coupon impossible",
        description:
          e instanceof Error ? e.message : "Réessayez dans un instant",
      });
    } finally {
      inFlightRef.current = false;
      setCashing(false);
    }
  };

  const hasScore = bet.matchHomeScore != null && bet.matchAwayScore != null;
  const matchLive = bet.matchStatus === "live" && hasScore;
  const matchFinished = bet.matchStatus === "finished" && hasScore;
  const homeWon =
    matchFinished && (bet.matchHomeScore ?? 0) > (bet.matchAwayScore ?? 0);
  const awayWon =
    matchFinished &&
    bet.awayTeam != null &&
    (bet.matchAwayScore ?? 0) > (bet.matchHomeScore ?? 0);

  return (
    <View
      style={[
        styles.card,
        won && styles.cardWon,
        lost && styles.cardLost,
      ]}
    >
      {/* En-tête */}
      <View style={styles.headRow}>
        <Pressable
          onPress={() => router.push(detailHref)}
          style={styles.headLeft}
        >
          {isPrediction ? (
            <TrendingUp
              size={14}
              color={COLORS.betclicRed}
              strokeWidth={2.3}
            />
          ) : (
            <SportIcon sport={bet.sport} size={14} color={COLORS.dim} />
          )}
          <Text numberOfLines={1} style={styles.leagueText}>
            {bet.league}
          </Text>
          {isPrediction || !bet.matchStartsAt || live ? (
            <>
              <Text style={styles.dot}>·</Text>
              <Text numberOfLines={1} style={styles.dateText}>
                {formatPlacedAt(
                  bet.status !== "pending"
                    ? (bet.settledAt ?? bet.placedAt)
                    : bet.placedAt
                )}
              </Text>
            </>
          ) : null}
        </Pressable>

        <View style={styles.headRight}>
          {!isPrediction && bet.matchStartsAt && !live ? (
            <Text style={styles.kickoffText}>
              {formatKickoff(bet.matchStartsAt)}
            </Text>
          ) : null}
          <Pressable
            onPress={() => (onShare ? onShare(bet) : openShareTicket(bet))}
            style={styles.flexPill}
          >
            <Share2 size={12} color={COLORS.mist} strokeWidth={2.2} />
            <Text style={styles.flexText}>Flex</Text>
          </Pressable>
          <StatusPill
            status={bet.status}
            live={live}
            minute={bet.matchMinute}
            clockSource={
              live
                ? {
                    matchId: bet.matchId,
                    status: "live",
                    minute: bet.matchMinute,
                    startsAt: bet.matchStartsAt,
                    source: bet.matchSource ?? null,
                    clockAnchor: bet.matchClockAnchor ?? null,
                  }
                : null
            }
          />
        </View>
      </View>

      <Pressable onPress={() => router.push(detailHref)}>
        {/* Corps */}
        <View style={styles.bodyWrap}>
          {isPrediction ? (
            <View style={styles.predRow}>
              <Text style={styles.predQuestion}>{bet.question}</Text>
              <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
            </View>
          ) : (
            <View style={styles.previewRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <TicketTeamRow
                  name={bet.homeTeam}
                  logo={bet.homeLogo}
                  score={hasScore ? bet.matchHomeScore : null}
                  winner={homeWon}
                  isLive={matchLive}
                  isFinished={matchFinished}
                />
                <TicketTeamRow
                  name={bet.awayTeam ?? ""}
                  logo={bet.awayLogo}
                  score={hasScore ? bet.matchAwayScore : null}
                  winner={awayWon}
                  isLive={matchLive}
                  isFinished={matchFinished}
                />
              </View>
              <ChevronRight size={16} color={COLORS.dim} strokeWidth={2.2} />
            </View>
          )}

          <View style={styles.selectionBar}>
            <Text numberOfLines={1} style={styles.selectionBarText}>
              {bet.selectionLabel}
            </Text>
            <Text style={styles.selectionOdds}>
              {formatOdds(bet.odds, oddsFormat)}
            </Text>
          </View>
        </View>

        {/* Montants en ligne */}
        <View style={styles.amountsRow}>
          <Amount label="Mise" value={eur(bet.stake)} tone="neutral" />
          <Amount
            label="Cote"
            value={formatOdds(bet.odds, oddsFormat)}
            tone="neutral"
          />
          {won ? (
            <Amount
              label="Gain reçu"
              value={`+${eur(bet.potentialWin)}`}
              tone="win"
            />
          ) : lost ? (
            <Amount
              label="Résultat"
              value={`-${eur(bet.stake)}`}
              tone="lost"
            />
          ) : cashed ? (
            <Amount
              label="Vendu pour"
              value={`+${eur(bet.cashOutAmount ?? 0)}`}
              tone="cash"
            />
          ) : voided ? (
            <Amount
              label="Remboursé"
              value={`+${eur(bet.stake)}`}
              tone="neutral"
            />
          ) : (
            <Amount
              label="Gain max"
              value={eur(bet.potentialWin)}
              tone="pot"
            />
          )}
        </View>
      </Pressable>

      {canCashOut ? (
        <View style={styles.cashoutSection}>
          {cashoutChanged ? (
            <View style={styles.cashoutAlert}>
              <AlertTriangle size={14} color="#b45309" strokeWidth={2.3} />
              <Text style={styles.cashoutAlertText}>
                Montant mis à jour : {eur(cashoutChanged.previousCashout)} →{" "}
                {eur(cashoutChanged.currentCashout)}. Confirmez à nouveau.
              </Text>
            </View>
          ) : null}
          <SlideToCashOut
            amount={effectiveCashOut!}
            stake={bet.stake}
            loading={cashing}
            onConfirm={doCashOut}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.edge,
    backgroundColor: "#ffffff",
    padding: 14,
    shadowColor: "#111827",
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardWon: {
    borderColor: "rgba(21, 128, 61, 0.38)",
  },
  cardLost: {
    borderColor: "rgba(225, 0, 20, 0.25)",
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  comboLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  boostMiniBadge: {
    borderRadius: 6,
    backgroundColor: "rgba(21, 128, 61, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  boostMiniText: {
    fontSize: 9.5,
    fontWeight: "700",
    color: COLORS.win,
  },
  leagueText: {
    flexShrink: 1,
    fontSize: 11.5,
    fontWeight: "500",
    color: COLORS.mist,
  },
  dot: {
    fontSize: 11,
    color: COLORS.dim,
  },
  dateText: {
    fontSize: 11,
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  headRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  kickoffText: {
    fontSize: 10,
    fontWeight: "500",
    color: COLORS.dim,
    fontVariant: ["tabular-nums"],
  },
  flexPill: {
    height: 24,
    borderRadius: 999,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  flexText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.mist,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusWon: {
    backgroundColor: "rgba(21, 128, 61, 0.12)",
  },
  statusLost: {
    backgroundColor: "rgba(225, 0, 20, 0.12)",
  },
  statusCashed: {
    backgroundColor: "rgba(14, 165, 233, 0.14)",
  },
  statusVoid: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
  },
  statusPending: {
    backgroundColor: COLORS.elev,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.betclicRed,
  },
  bodyWrap: {
    marginTop: 10,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  predRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  predQuestion: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: "600",
    color: COLORS.ink,
    lineHeight: 20,
  },
  previewLegRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  previewLegLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  previewLegTitle: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  lineThroughMist: {
    color: COLORS.mist,
    textDecorationLine: "line-through",
  },
  previewLegOdds: {
    fontSize: 12.5,
    fontWeight: "700",
    color: COLORS.mist,
    fontVariant: ["tabular-nums"],
  },
  miniStatusCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  miniPendingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(17,24,39,0.20)",
  },
  ticketTeamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ticketTeamName: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "600",
  },
  ticketScorePill: {
    minWidth: 22,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  ticketScoreText: {
    fontSize: 13.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  selectionBar: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  selectionBarText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: "600",
    color: COLORS.ink,
  },
  selectionOdds: {
    fontSize: 13.5,
    fontWeight: "700",
    color: COLORS.ink,
    fontVariant: ["tabular-nums"],
  },
  detailsInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  detailsText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.betclicRed,
  },
  amountsRow: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.edge,
    paddingTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  amountInline: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  amountLabel: {
    fontSize: 10.5,
    fontWeight: "500",
    color: COLORS.dim,
  },
  amountVal: {
    fontSize: 13.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cashoutSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(228,230,235,0.8)",
    paddingTop: 12,
    gap: 8,
  },
  cashoutAlert: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    backgroundColor: "rgba(245,158,11,0.10)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cashoutAlertText: {
    flex: 1,
    fontSize: 11.5,
    color: "#78350f",
    lineHeight: 16,
  },
});
