"use client";

import { publicAssetUrl } from "@/lib/public-assets";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, CircleHelp, Eye, EyeOff, Hand, Play } from "lucide-react";
import { NetworkBadge, OfflineBanner } from "@/components/network-badge";
import { useApp } from "@/components/providers";
import {
  formatLocalAmount,
  formatLocalInputString,
  formatPresetChip,
  localToEur,
  maxSpendableLocalFromEur,
  type CurrencyCode,
} from "@/lib/countries";
import { eur } from "@/lib/format";
import { fetchWithTimeout, postJson } from "@/lib/network-manager";
import s from "./accelerator-game.module.css";

const MAX_BET_EUR = 50;
const PING_PERIOD_MS = 500;
const MIN_HOLD_MS = 350;

const V_MIN = 1.01;
const V_MAX = 2.0;

// ---------------- Géométrie de la jauge ----------------

const GX = 100;
const GY = 100;
const GR = 72;
const GSTROKE = 14;
const G_LABEL_R = GR + 17;

function vToTheta(v: number): number {
  const t = (Math.max(V_MIN, Math.min(V_MAX, v)) - V_MIN) / (V_MAX - V_MIN);
  return Math.PI * (1 - t);
}

function polar(th: number, r = GR) {
  return { x: GX + r * Math.cos(th), y: GY - r * Math.sin(th) };
}

function arcPath(t1: number, t2: number, r = GR): string {
  const p1 = polar(t1, r);
  const p2 = polar(t2, r);
  const d = Math.abs(t2 - t1);
  const large = d > Math.PI ? 1 : 0;
  const sweep = t2 < t1 ? 1 : 0;
  return `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)} A ${r.toFixed(3)} ${r.toFixed(3)} 0 ${large} ${sweep} ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const el = (tag: string, attrs: Record<string, string>) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const RISK_SECTORS = [
  { lo: 1.01, hi: 1.25, color: "#10b981" },
  { lo: 1.25, hi: 1.5, color: "#22c55e" },
  { lo: 1.5, hi: 1.75, color: "#eab308" },
  { lo: 1.75, hi: 2.0, color: "#ef4444" },
];

const MAJORS = [1.01, 1.5, 2];
const EPS = 1e-6;
const approxEq = (a: number, b: number) => Math.abs(a - b) < EPS;

function graduationValues(): number[] {
  const out: number[] = [];
  for (let v = V_MIN; v < V_MAX - 1e-9; v += 0.1) {
    out.push(Math.round(v * 100) / 100);
  }
  out.push(V_MAX);
  return out;
}

function endsFor(c: string) {
  if (c === "major") return { in: 78, out: 84.5 };
  return { in: 79.5, out: 84 };
}

function clsFor(v: number): string {
  if (MAJORS.some((m) => approxEq(m, v))) return "major";
  if (approxEq(v * 2, Math.round(v * 2))) return "minor";
  return "micro";
}

const emptySubscribe = () => () => {};

export default function AcceleratorPage() {
  const { currency, currencyConfig, setBalance } = useApp();
  const minBetLocal = currencyConfig.minStakeLocal;
  const maxBetLocal = Math.max(
    minBetLocal,
    maxSpendableLocalFromEur(MAX_BET_EUR, currency)
  );
  const quickBetsLocal = currencyConfig.stakePresets.map((q) =>
    Math.min(maxBetLocal, q)
  );
  const fmt = useCallback(
    (eurAmount: number) => eur(eurAmount, currency),
    [currency]
  );
  const fmtRef = useRef(fmt);

  const mount = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [bal, setBal] = useState(0);
  const [balanceHidden, setBalanceHidden] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("acc_balance_hidden") === "true" : false
  );
  const [balFlash, setBalFlash] = useState(false);
  const [stakeByCur, setStakeByCur] = useState<Partial<Record<CurrencyCode, string>>>({});
  const stake =
    stakeByCur[currency] ??
    formatLocalInputString(currencyConfig.stakePresets[0], currency, ".");
  const setStake = useCallback(
    (next: string) => {
      setStakeByCur((prev) => ({ ...prev, [currency]: next }));
    },
    [currency]
  );
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"start" | "hold">("start");
  const [crashShow, setCrashShow] = useState(false);
  const [crashMult, setCrashMult] = useState(1.01);
  const [modal, setModal] = useState<{
    show: boolean;
    win: boolean;
    title: string;
    amount: string;
    mult: string;
  }>({
    show: false,
    win: true,
    title: "",
    amount: "",
    mult: "",
  });
  const [rulesOpen, setRulesOpen] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);

  const railRef = useRef<SVGPathElement | null>(null);
  const sectorsRef = useRef<SVGGElement | null>(null);
  const ticksRef = useRef<SVGGElement | null>(null);
  const labelsRef = useRef<SVGGElement | null>(null);
  const needleRef = useRef<SVGGElement | null>(null);
  const needleShapeRef = useRef<SVGPolygonElement | null>(null);
  const valRef = useRef<HTMLDivElement | null>(null);
  const stakeDispRef = useRef<HTMLSpanElement | null>(null);
  const payoutDispRef = useRef<HTMLSpanElement | null>(null);
  const gaugeCardRef = useRef<HTMLDivElement | null>(null);

  const displayVRef = useRef(V_MIN);
  const gBaseRef = useRef(0.02911764705882353);
  const mMaxRef = useRef(V_MAX);
  const roundIdRef = useRef<number | null>(null);
  const baseBetRef = useRef<number | null>(null);
  const holdingRef = useRef(false);
  const isStartingRef = useRef(false);
  const isCashingOutRef = useRef(false);
  const releaseLockRef = useRef(false);
  const pingInFlightRef = useRef(false);
  const animIdRef = useRef(0);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameTsRef = useRef<number | null>(null);
  const crashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartedAtRef = useRef(0);
  const audioUnlockedRef = useRef(false);
  const sndHoldRef = useRef<HTMLAudioElement | null>(null);
  const sndCrashRef = useRef<HTMLAudioElement | null>(null);
  const sfxWinRef = useRef<HTMLAudioElement | null>(null);

  const gaugeApi = useRef<{ updateGauge: (v: number) => void } | null>(null);
  const endRef = useRef<(j: Record<string, unknown>) => void>(() => {});
  const animateLoopRef = useRef<(ts: number) => void>(() => {});
  const stopHoldLoopRef = useRef<(skip: boolean) => void>(() => {});

  useEffect(() => {
    if (!mount) return;

    function setNeedleAngle(theta: number) {
      const deg = (theta * 180) / Math.PI;
      needleRef.current?.setAttribute("transform", `rotate(${-deg} ${GX} ${GY})`);
    }

    function drawSectors() {
      const g = sectorsRef.current;
      if (!g) return;
      g.innerHTML = "";
      for (const seg of RISK_SECTORS) {
        const t1 = vToTheta(Math.max(V_MIN, seg.lo));
        const t2 = vToTheta(Math.min(V_MAX, seg.hi));
        g.appendChild(
          el("path", {
            d: arcPath(t1, t2, GR),
            fill: "none",
            stroke: seg.color,
            "stroke-width": String(GSTROKE),
            "stroke-linecap": "butt",
          })
        );
      }
    }

    function drawTicksAndLabels() {
      const gT = ticksRef.current;
      const gL = labelsRef.current;
      if (gT) {
        gT.innerHTML = "";
        const STROKE_COLOR: Record<string, string> = {
          major: "#e2e8f0",
          minor: "#94a3b8",
          micro: "#475569",
        };
        const STROKE_WIDTH: Record<string, string> = {
          major: "2",
          minor: "1.2",
          micro: "0.8",
        };
        for (const v of graduationValues()) {
          const th = vToTheta(v);
          const c = clsFor(v);
          const { in: ri, out: ro } = endsFor(c);
          const p1 = polar(th, ri);
          const p2 = polar(th, ro);
          gT.appendChild(
            el("line", {
              x1: p1.x.toFixed(2),
              y1: p1.y.toFixed(2),
              x2: p2.x.toFixed(2),
              y2: p2.y.toFixed(2),
              stroke: STROKE_COLOR[c],
              "stroke-width": STROKE_WIDTH[c],
              "stroke-linecap": "round",
            })
          );
        }
      }
      if (gL) {
        gL.innerHTML = "";
        for (const v of graduationValues()) {
          const th = vToTheta(v);
          const p = polar(th, G_LABEL_R);
          const major = MAJORS.some((m) => approxEq(m, v));
          if (!major) continue; // N'afficher que les repères majeurs (×1.01, ×1.50, ×2.00) pour une lecture nette sur mobile
          const tx = el("text", {
            x: p.x.toFixed(2),
            y: p.y.toFixed(2),
            fill: "#f8fafc",
            "font-size": "8.5",
            "font-weight": "700",
            "font-family": "system-ui, -apple-system, sans-serif",
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          });
          tx.textContent = `×${v.toFixed(2)}`;
          gL.appendChild(tx);
        }
      }
    }

    function buildNeedle() {
      const baseHalf = 5.5;
      const tipR = GR - 6;
      needleShapeRef.current?.setAttribute(
        "points",
        `${GX},${GY - baseHalf} ${GX},${GY + baseHalf} ${GX + tipR},${GY}`
      );
      setNeedleAngle(vToTheta(V_MIN));
    }

    function updateGauge(v: number) {
      if (valRef.current) valRef.current.textContent = v.toFixed(2);
      setNeedleAngle(vToTheta(v));
      if (baseBetRef.current != null && payoutDispRef.current) {
        payoutDispRef.current.textContent = fmtRef.current(baseBetRef.current * v);
      }
    }

    function buildStatic() {
      if (railRef.current) {
        railRef.current.setAttribute("d", arcPath(vToTheta(V_MIN), vToTheta(V_MAX), GR));
        railRef.current.setAttribute("stroke-width", String(GSTROKE));
      }
      drawSectors();
      drawTicksAndLabels();
      buildNeedle();
      updateGauge(V_MIN);
    }

    buildStatic();
    gaugeApi.current = { updateGauge };

    const onResize = () => buildStatic();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      gaugeApi.current = null;
    };
  }, [mount]);

  const unlockAudio = useCallback(async () => {
    if (audioUnlockedRef.current) return;
    try {
      if (!sndHoldRef.current) sndHoldRef.current = new Audio(publicAssetUrl("/maintien.mp3"));
      if (!sndCrashRef.current) sndCrashRef.current = new Audio(publicAssetUrl("/crashed.mp3"));
      if (!sfxWinRef.current) sfxWinRef.current = new Audio(publicAssetUrl("/cashout.mp3"));
      const h = sndHoldRef.current;
      h.muted = true;
      await h.play().catch(() => undefined);
      h.pause();
      h.currentTime = 0;
      h.muted = false;
      audioUnlockedRef.current = true;
    } catch {
      /* silencieux */
    }
  }, []);

  const stopHoldSound = useCallback(() => {
    const h = sndHoldRef.current;
    if (h) {
      h.pause();
      h.currentTime = 0;
    }
  }, []);

  const playHoldSound = useCallback(() => {
    try {
      if (sndCrashRef.current) {
        sndCrashRef.current.pause();
        sndCrashRef.current.currentTime = 0;
      }
      if (sfxWinRef.current) {
        sfxWinRef.current.pause();
        sfxWinRef.current.currentTime = 0;
      }
      const h = sndHoldRef.current;
      if (h) {
        h.loop = true;
        h.volume = 0.85;
        h.play().catch(() => undefined);
      }
    } catch {
      /* silencieux */
    }
  }, []);

  const playWinSound = useCallback(() => {
    try {
      stopHoldSound();
      const w = sfxWinRef.current;
      if (w) {
        w.currentTime = 0;
        w.volume = 1.0;
        w.play().catch(() => undefined);
      }
    } catch {
      /* silencieux */
    }
  }, [stopHoldSound]);

  const playCrashSound = useCallback(() => {
    try {
      stopHoldSound();
      const c = sndCrashRef.current;
      if (c) {
        c.currentTime = 0;
        c.volume = 1.0;
        c.play().catch(() => undefined);
      }
    } catch {
      /* silencieux */
    }
  }, [stopHoldSound]);

  const post = useCallback(
    async (body: Record<string, unknown>, opts?: { retries?: number; timeoutMs?: number }) => {
      const res = await postJson<Record<string, unknown>>("/api/accelerator", body, {
        retries: opts?.retries ?? 0,
        timeoutMs: opts?.timeoutMs,
      });
      if (res.data) return res.data;
      return { status: "error", message: res.status === 0 ? "Erreur réseau" : "Erreur serveur" };
    },
    []
  );

  const setBalFlashSoon = useCallback(
    (n: number) => {
      setBal(n);
      setBalance(n);
      setBalFlash(true);
      setTimeout(() => setBalFlash(false), 500);
    },
    [setBalance]
  );

  const resetPayoutLine = useCallback(() => {
    baseBetRef.current = null;
    if (stakeDispRef.current) stakeDispRef.current.textContent = "—";
    if (payoutDispRef.current) payoutDispRef.current.textContent = "—";
  }, []);

  const triggerCrashAnimation = useCallback(
    (mult: number) => {
      setCrashMult(mult);
      setCrashShow(true);
      if (crashTimerRef.current) clearTimeout(crashTimerRef.current);
      crashTimerRef.current = setTimeout(() => setCrashShow(false), 2000);
      if (gaugeCardRef.current) {
        gaugeCardRef.current.classList.remove(s.crashed);
        void gaugeCardRef.current.offsetWidth;
        gaugeCardRef.current.classList.add(s.crashed);
      }
      playCrashSound();
    },
    [playCrashSound]
  );

  const cleanupGameLoop = useCallback(() => {
    holdingRef.current = false;
    stopHoldSound();
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (animIdRef.current) {
      cancelAnimationFrame(animIdRef.current);
      animIdRef.current = 0;
    }
  }, [stopHoldSound]);

  const handleEnd = useCallback(
    (j: Record<string, unknown>) => {
      cleanupGameLoop();
      const mult = typeof j.multiplier === "number" ? j.multiplier : displayVRef.current;
      displayVRef.current = mult;
      gaugeApi.current?.updateGauge(mult);

      if (j.new_balance != null) setBalFlashSoon(Number(j.new_balance));
      const st = String(j.status ?? "");

      if (st === "crashed" || st === "postcrashed") {
        triggerCrashAnimation(mult);
        resetPayoutLine();
      } else if (st === "cashed") {
        playWinSound();
        const win = Number(j.win_amount ?? 0);
        const jackpot = Boolean(j.jackpot);
        setModal({
          show: true,
          win: true,
          title: jackpot ? "JACKPOT !" : "Encaissé !",
          amount: fmtRef.current(win),
          mult: `×${mult.toFixed(2)}`,
        });
        if (payoutDispRef.current) payoutDispRef.current.textContent = fmtRef.current(win);
      }
      setError("");
      setMode("start");
      roundIdRef.current = null;
    },
    [
      cleanupGameLoop,
      playWinSound,
      resetPayoutLine,
      setBalFlashSoon,
      setModal,
      triggerCrashAnimation,
    ]
  );

  const pingTap = useCallback(async () => {
    if (!roundIdRef.current || pingInFlightRef.current) return;
    pingInFlightRef.current = true;
    const j = await post({ action: "tap" }, { timeoutMs: 10000 });
    pingInFlightRef.current = false;
    if (!j) return;
    if (j.status === "ok" && typeof j.multiplier === "number") {
      const sv = j.multiplier;
      if (sv > displayVRef.current) {
        displayVRef.current = sv;
        gaugeApi.current?.updateGauge(sv);
      }
      return;
    }
    if (j.status === "crashed" || j.status === "cashed" || j.status === "postcrashed") {
      endRef.current(j);
    }
  }, [post]);

  const animateLoop = useCallback((ts: number) => {
    if (!holdingRef.current) {
      if (animIdRef.current) {
        cancelAnimationFrame(animIdRef.current);
        animIdRef.current = 0;
      }
      return;
    }
    if (lastFrameTsRef.current == null) lastFrameTsRef.current = ts;
    const dt = Math.min(0.1, (ts - lastFrameTsRef.current) / 1000);
    lastFrameTsRef.current = ts;

    displayVRef.current += gBaseRef.current * dt;
    if (displayVRef.current > mMaxRef.current) displayVRef.current = mMaxRef.current;
    gaugeApi.current?.updateGauge(displayVRef.current);

    if (displayVRef.current >= mMaxRef.current - 1e-9) {
      stopHoldLoopRef.current(false);
      return;
    }
    animIdRef.current = requestAnimationFrame(animateLoopRef.current);
  }, []);

  const startHoldLoop = useCallback(async () => {
    if (holdingRef.current) return;
    holdingRef.current = true;
    lastFrameTsRef.current = null;
    releaseLockRef.current = false;

    await unlockAudio().catch(() => undefined);
    if (!holdingRef.current) return;

    const hs = await post({ action: "hold_start" }, { timeoutMs: 10000, retries: 1 });
    if (!holdingRef.current) return;
    if (hs && (hs.status === "crashed" || hs.status === "postcrashed")) {
      cleanupGameLoop();
      endRef.current(hs);
      return;
    }
    if (hs && hs.status === "ok" && typeof hs.multiplier === "number") {
      displayVRef.current = hs.multiplier;
      gaugeApi.current?.updateGauge(hs.multiplier);
    }

    playHoldSound();
    animIdRef.current = requestAnimationFrame(animateLoopRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(pingTap, PING_PERIOD_MS);
  }, [cleanupGameLoop, pingTap, playHoldSound, post, unlockAudio]);

  const releaseHold = useCallback(
    (force = false) => {
      if (!force && Date.now() - holdStartedAtRef.current < MIN_HOLD_MS) {
        cleanupGameLoop();
        return;
      }
      void stopHoldLoopRef.current(false);
    },
    [cleanupGameLoop]
  );

  const stopHoldLoop = useCallback(
    async (skipCashout: boolean) => {
      if (releaseLockRef.current) return;
      releaseLockRef.current = true;
      if (skipCashout) {
        cleanupGameLoop();
        setMode("start");
        releaseLockRef.current = false;
        return;
      }
      if (isCashingOutRef.current) {
        releaseLockRef.current = false;
        return;
      }
      isCashingOutRef.current = true;
      cleanupGameLoop();
      setCashingOut(true);
      try {
        const j = await post(
          { action: "cashout", client_multiplier: displayVRef.current },
          { retries: 4, timeoutMs: 10000 }
        );
        if (j) endRef.current(j);
        else setError("Erreur réseau");
      } finally {
        setCashingOut(false);
        isCashingOutRef.current = false;
        releaseLockRef.current = false;
      }
    },
    [cleanupGameLoop, post]
  );

  const startGame = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setError("");
    setCrashShow(false);
    gaugeCardRef.current?.classList.remove(s.crashed);
    gaugeApi.current?.updateGauge(V_MIN);
    try {
      const localBet = parseFloat(stake.replace(",", "."));
      if (Number.isNaN(localBet) || localBet <= 0) {
        setError("Mise invalide");
        return;
      }
      if (localBet < minBetLocal) {
        setError(`Mise minimale : ${formatLocalAmount(minBetLocal, currency)}`);
        return;
      }
      const bet = localToEur(localBet, currency, bal);
      const j = await post({ action: "start_game", bet }, { timeoutMs: 10000 });
      if (j.status === "success") {
        roundIdRef.current = typeof j.round_id === "number" ? j.round_id : null;
        setBalFlashSoon(Number(j.new_balance));
        gBaseRef.current =
          typeof j.g_base === "number" && j.g_base > 0 ? j.g_base : gBaseRef.current;
        mMaxRef.current =
          typeof j.m_max === "number" && j.m_max > 0 ? j.m_max : mMaxRef.current;
        displayVRef.current = typeof j.multiplier === "number" ? j.multiplier : V_MIN;

        const betNorm = Number(j.bet_amount_display ?? bet);
        baseBetRef.current = betNorm;
        if (stakeDispRef.current) stakeDispRef.current.textContent = fmt(betNorm);
        if (payoutDispRef.current)
          payoutDispRef.current.textContent = fmt(betNorm * displayVRef.current);

        setMode("hold");
        gaugeApi.current?.updateGauge(displayVRef.current);
      } else {
        setError((j.message as string) || "Erreur");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      isStartingRef.current = false;
    }
  }, [bal, currency, fmt, minBetLocal, post, setBalFlashSoon, stake]);

  const formatLocalStake = useCallback(
    (val: number) =>
      currencyConfig.decimals === 0 ? String(Math.round(val)) : val.toFixed(2),
    [currencyConfig.decimals]
  );

  const setQuickStake = (val: number) => {
    const clamped = Math.max(minBetLocal, Math.min(maxBetLocal, val));
    setStake(formatLocalStake(clamped));
    setError("");
  };

  const onStakeBlur = useCallback(() => {
    let val = parseFloat(stake.replace(",", "."));
    if (Number.isNaN(val) || val < minBetLocal) val = minBetLocal;
    if (val > maxBetLocal) val = maxBetLocal;
    setStake(formatLocalStake(val));
  }, [formatLocalStake, maxBetLocal, minBetLocal, setStake, stake]);

  const modeRef = useRef(mode);

  useEffect(() => {
    fmtRef.current = fmt;
    endRef.current = handleEnd;
    animateLoopRef.current = animateLoop;
    stopHoldLoopRef.current = stopHoldLoop;
    modeRef.current = mode;
  }, [animateLoop, fmt, handleEnd, mode, stopHoldLoop]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Enter" && modeRef.current === "start") {
        e.preventDefault();
        startGame();
      }
      if (e.code === "Space" && modeRef.current === "hold") {
        e.preventDefault();
        holdStartedAtRef.current = Date.now();
        unlockAudio().then(() => startHoldLoop());
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && modeRef.current === "hold") {
        e.preventDefault();
        releaseHold();
      }
    };
    const onVisibility = () => {
      if (document.hidden) stopHoldSound();
      if (document.hidden && modeRef.current === "hold" && roundIdRef.current) {
        void stopHoldLoop(false);
      }
    };
    const onPointerUp = () => {
      if (holdingRef.current) releaseHold();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onPointerUp);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [releaseHold, startGame, startHoldLoop, stopHoldLoop, stopHoldSound, unlockAudio]);

  useEffect(() => {
    fetchWithTimeout<Record<string, unknown>>(5000, "/api/accelerator").then((res) => {
      const d = res.data;
      if (res.ok && d && d.status === "success") {
        setBal(Number(d.balance));
      }
    });
  }, []);

  const toggleBalance = () => {
    setBalanceHidden((h) => {
      localStorage.setItem("acc_balance_hidden", String(!h));
      return !h;
    });
  };

  const balText = balanceHidden ? "••••" : fmt(bal);
  const isHold = mode === "hold";

  const holdButtonProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!isHold) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      holdStartedAtRef.current = Date.now();
      unlockAudio().then(() => startHoldLoop());
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (isHold) {
        e.preventDefault();
        releaseHold();
      }
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (isHold) {
        e.preventDefault();
        releaseHold();
      }
    },
  };

  if (!mount) return null;

  return createPortal(
    <div className={s.acc}>
      <div className={s.shell}>
        <header className={s.header}>
          <div className={s.headerLeft}>
            <Link href="/jeux" className={s.btnIcon} aria-label="Retour aux mini-jeux">
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </Link>
            <div className={s.logo}>
              Accelerator <span>Pro</span>
            </div>
          </div>

          <div className={s.headerRight}>
            <NetworkBadge />
            <button
              type="button"
              onClick={toggleBalance}
              className={s.balancePill}
              aria-label="Afficher ou masquer le solde"
            >
              <span className={s.amountHl} style={{ color: balFlash ? "#4ade80" : undefined }}>
                {balText}
              </span>
              {balanceHidden ? (
                <EyeOff className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
              ) : (
                <Eye className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              className={s.btnIcon}
              onClick={() => setRulesOpen(true)}
              aria-label="Règles du jeu"
            >
              <CircleHelp className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
        </header>

        <OfflineBanner />

        <main className={s.stage}>
          <div className={s.gaugeCard} ref={gaugeCardRef}>
            <div className={s.gbox}>
              <svg viewBox="0 0 200 116" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="railGradient" x1="0%" y1="0%" x2="100%">
                    <stop offset="0%" stopColor="#1e293b" />
                    <stop offset="100%" stopColor="#0f172a" />
                  </linearGradient>
                  <linearGradient id="needleGradient" x1="0%" y1="0%" x2="100%">
                    <stop offset="0%" stopColor="#f8fafc" />
                    <stop offset="100%" stopColor="#cbd5e1" />
                  </linearGradient>
                </defs>
                <path
                  ref={railRef}
                  fill="none"
                  stroke="url(#railGradient)"
                  strokeWidth={16}
                  strokeLinecap="round"
                />
                <g ref={sectorsRef} />
                <g ref={ticksRef} />
                <g ref={labelsRef} />
                <g ref={needleRef}>
                  <polygon ref={needleShapeRef} fill="url(#needleGradient)" />
                  <circle cx={100} cy={100} r={5} fill="#0f172a" stroke="#cbd5e1" strokeWidth={1.5} />
                  <circle cx={100} cy={100} r={2.5} fill="url(#needleGradient)" />
                </g>
              </svg>
            </div>

            <div className={s.valueRow}>
              <span className={s.multPrefix}>×</span>
              <div className={s.value} ref={valRef}>
                1.01
              </div>
            </div>

            <div className={s.payout}>
              <span ref={stakeDispRef}>—</span>
              <span className={s.arrow}>→</span>
              <span className={s.gain} ref={payoutDispRef}>
                —
              </span>
            </div>

            <div className={`${s.crashBadge} ${crashShow ? s.show : ""}`}>
              CRASH ×{crashMult.toFixed(2)}
            </div>
          </div>

          <p className={s.hint}>
            {isHold
              ? "Maintenez le bouton enfoncé puis relâchez pour encaisser"
              : `Choisissez votre mise (${formatLocalAmount(minBetLocal, currency)} à ${formatLocalAmount(maxBetLocal, currency)}) puis lancez la manche`}
          </p>
        </main>

        <section className={s.controls}>
          <div className={s.inputRow}>
            <div className={s.inputGroup}>
              <input
                type="text"
                inputMode={currencyConfig.decimals === 0 ? "numeric" : "decimal"}
                className={s.stakeIn}
                placeholder="Mise"
                value={stake}
                onChange={(e) => setStake(e.target.value.replace(/[^0-9.,]/g, ""))}
                onBlur={onStakeBlur}
                disabled={isHold}
                aria-label="Montant de la mise"
              />
              <span className={s.currencyBadge}>{currencyConfig.symbol}</span>
            </div>
          </div>

          <div className={s.quickGrid}>
            {quickBetsLocal.map((q, idx) => (
              <button
                key={`${q}-${idx}`}
                type="button"
                disabled={isHold}
                onClick={() => setQuickStake(q)}
                className={s.quickBtn}
              >
                {formatPresetChip(q, currency)}
              </button>
            ))}
            <button
              type="button"
              disabled={isHold}
              onClick={() =>
                setQuickStake(
                  Math.min(
                    maxBetLocal,
                    Math.max(minBetLocal, maxSpendableLocalFromEur(bal, currency))
                  )
                )
              }
              className={`${s.quickBtn} ${s.quickMax}`}
            >
              MAX
            </button>
          </div>

          <button
            type="button"
            className={`${s.btnPlace} ${isHold ? s.cashout : ""}`}
            onClick={() => {
              if (!isHold) {
                unlockAudio().then(() => startGame());
              }
            }}
            {...(isHold ? holdButtonProps : {})}
          >
            {isHold ? (
              <>
                <Hand className="h-5 w-5" strokeWidth={2.4} />
                {cashingOut ? "ENCAISSEMENT…" : "MAINTENIR POUR MONTER"}
              </>
            ) : (
              <>
                <Play className="h-5 w-5" strokeWidth={2.4} />
                MISER
              </>
            )}
          </button>

          {error && <div className={s.errorMsg}>{error}</div>}
        </section>

        {/* Modale résultat */}
        <div
          className={`${s.modalOverlay} ${modal.show ? s.show : ""}`}
          onClick={() => setModal((m) => ({ ...m, show: false }))}
        >
          <div
            className={`${s.modalV2} ${modal.win ? s.win : s.lose}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.title}>{modal.title}</div>
            <div className={s.amount}>{modal.amount}</div>
            {modal.mult && <div className={s.multLabel}>Multiplicateur {modal.mult}</div>}
            <button
              type="button"
              className={s.btnCloseModal}
              onClick={() => setModal((m) => ({ ...m, show: false }))}
            >
              Continuer
            </button>
          </div>
        </div>

        {/* Modale règles */}
        <div
          className={`${s.modalOverlay} ${rulesOpen ? s.show : ""}`}
          onClick={() => setRulesOpen(false)}
        >
          <div className={s.modalV2} onClick={(e) => e.stopPropagation()}>
            <div className={s.title}>Règles</div>
            <ul className={s.rulesText}>
              <li>Le multiplicateur progresse de ×1.01 jusqu&apos;à ×2.00.</li>
              <li>Maintenez le bouton pour monter, relâchez pour encaisser.</li>
              <li>Si le crash survient avant le relâchement, la mise est perdue.</li>
            </ul>
            <button type="button" className={s.btnCloseModal} onClick={() => setRulesOpen(false)}>
              Compris
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
