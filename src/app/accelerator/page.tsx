"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CircleHelp, Eye, EyeOff, Hand, Play, Trophy } from "lucide-react";
import s from "./accelerator-game.module.css";

const SYM = "$";
const DEC = 2;
const MIN_BET = 1;
const MAX_BET = 50;
const PING_PERIOD_MS = 500;

const V_MIN = 1.01;
const V_MAX = 2.0;

function fmt(n: number): string {
  return (
    Number(n)
      .toLocaleString("fr-FR", {
        minimumFractionDigits: DEC,
        maximumFractionDigits: DEC,
      })
      .replace(/\u202F/g, " ") +
    " " +
    SYM
  );
}

// ---------------- Géométrie de la jauge (port de accelerator.php) ----------------

const GX = 100;
const GY = 100;
const GR = 72;
const GSTROKE = 14;
const G_LABEL_R = GR + GSTROKE / 2 + 6;

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

function endsFor(c: string) {
  if (c === "major") return { in: GR - 5.5, out: GR + 5.5 };
  if (c === "minor") return { in: GR - 3.5, out: GR + 3.5 };
  return { in: GR - 2.2, out: GR + 2.2 };
}

function clsFor(v: number): string {
  if (MAJORS.some((m) => approxEq(m, v))) return "major";
  if (approxEq(v * 2, Math.round(v * 2))) return "minor";
  return "micro";
}

// ---------------- Composant ----------------

export default function AcceleratorPage() {
  const [mount, setMount] = useState(false);
  const [bal, setBal] = useState(0);
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [balFlash, setBalFlash] = useState(false);
  const [stake, setStake] = useState("1.00");
  const [sliderPct, setSliderPct] = useState(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"start" | "hold">("start");
  const [crashShow, setCrashShow] = useState(false);
  const [crashMult, setCrashMult] = useState(1.01);
  const [modal, setModal] = useState<{ show: boolean; win: boolean; title: string; amount: string; mult: string }>({
    show: false,
    win: true,
    title: "",
    amount: "",
    mult: "",
  });
  const [rulesOpen, setRulesOpen] = useState(false);

  // Refs SVG
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

  // Refs jeu
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
  const lastPingAtRef = useRef(0);
  const animIdRef = useRef(0);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFrameTsRef = useRef<number | null>(null);
  const crashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioUnlockedRef = useRef(false);
  const sndHoldRef = useRef<HTMLAudioElement | null>(null);
  const sndCrashRef = useRef<HTMLAudioElement | null>(null);
  const sfxWinRef = useRef<HTMLAudioElement | null>(null);

  const gaugeApi = useRef<{ updateGauge: (v: number) => void } | null>(null);
  const endRef = useRef<(j: Record<string, unknown>) => void>(() => {});
  const animateLoopRef = useRef<(ts: number) => void>(() => {});
  const stopHoldLoopRef = useRef<(skip: boolean) => void>(() => {});

  // ---------- Construction de la jauge (après montage du portal) ----------
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
        const p = el("path", {
          d: arcPath(t1, t2, GR),
          fill: "none",
          stroke: seg.color,
          "stroke-width": String(GSTROKE),
          "stroke-linecap": "butt",
        });
        g.appendChild(p);
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
        for (let v = V_MIN; v <= V_MAX + 1e-9; v += 0.1) {
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
        for (const v of MAJORS) {
          const th = vToTheta(v);
          const p = polar(th, G_LABEL_R);
          const tx = el("text", {
            x: p.x.toFixed(2),
            y: p.y.toFixed(2),
            fill: "#ffffff",
            "font-size": "9",
            "font-weight": "800",
            "font-family": "Montserrat, sans-serif",
            "text-anchor": "middle",
            "dominant-baseline": "middle",
          });
          tx.textContent = `×${v.toFixed(2)}`;
          gL.appendChild(tx);
        }
      }
    }

    function buildNeedle() {
      const baseHalf = 6;
      const tipR = GR - 6;
      needleShapeRef.current?.setAttribute("points", `${GX},${GY - baseHalf} ${GX},${GY + baseHalf} ${GX + tipR},${GY}`);
      setNeedleAngle(vToTheta(V_MIN));
    }

    function updateGauge(v: number) {
      if (valRef.current) valRef.current.textContent = v.toFixed(2);
      setNeedleAngle(vToTheta(v));
      if (baseBetRef.current != null && payoutDispRef.current) {
        payoutDispRef.current.textContent = fmt(baseBetRef.current * v);
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

  // ---------- Sons ----------
  const unlockAudio = useCallback(async () => {
    if (audioUnlockedRef.current) return;
    try {
      if (!sndHoldRef.current) sndHoldRef.current = new Audio("/maintien.mp3");
      if (!sndCrashRef.current) sndCrashRef.current = new Audio("/crashed.mp3");
      if (!sfxWinRef.current) sfxWinRef.current = new Audio("/cashout.mp3");
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
      const c = sndCrashRef.current;
      const w = sfxWinRef.current;
      if (c) {
        c.pause();
        c.currentTime = 0;
      }
      if (w) {
        w.pause();
        w.currentTime = 0;
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

  // ---------- API ----------
  const post = useCallback(async (body: Record<string, unknown>) => {
    try {
      const r = await fetch("/api/accelerator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) return await r.json();
      return { status: "error", message: "Réponse non-JSON du serveur" };
    } catch {
      return { status: "error", message: "Erreur réseau" };
    }
  }, []);

  // ---------- UI helpers ----------
  const setBalFlashSoon = useCallback((n: number) => {
    setBal(n);
    setBalFlash(true);
    setTimeout(() => setBalFlash(false), 500);
  }, []);

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
        gaugeCardRef.current.classList.remove("crashed");
        void gaugeCardRef.current.offsetWidth;
        gaugeCardRef.current.classList.add("crashed");
      }
      playCrashSound();
    },
    [playCrashSound]
  );

  // ---------- Fin de manche (cash ou crash) ----------
  const handleEnd = useCallback(
    (j: Record<string, unknown>) => {
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
          title: jackpot ? "JACKPOT !" : "Gagné !",
          amount: fmt(win),
          mult: `×${mult.toFixed(2)}`,
        });
        if (payoutDispRef.current) payoutDispRef.current.textContent = fmt(win);
      }
      setError("");
      setMode("start");
      roundIdRef.current = null;
    },
    [playWinSound, resetPayoutLine, setBalFlashSoon, triggerCrashAnimation]
  );

  endRef.current = handleEnd;

  // ---------- Boucle de maintien ----------
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

  const pingTap = useCallback(async () => {
    if (!roundIdRef.current) return;
    if (pingInFlightRef.current && Date.now() - lastPingAtRef.current <= 250) return;
    pingInFlightRef.current = true;
    lastPingAtRef.current = Date.now();
    const j = await post({ action: "tap" });
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
    await unlockAudio().catch(() => undefined);
    if (holdingRef.current) return;
    holdingRef.current = true;
    lastFrameTsRef.current = null;
    releaseLockRef.current = false;
    playHoldSound();
    animIdRef.current = requestAnimationFrame(animateLoopRef.current);
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(pingTap, PING_PERIOD_MS);
  }, [pingTap, playHoldSound, unlockAudio]);

  const tapFinal = useCallback(async () => post({ action: "tap_final" }), [post]);

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
      try {
        const jf = await tapFinal();
        if (jf && (jf.status === "crashed" || jf.status === "cashed" || jf.status === "postcrashed")) {
          endRef.current(jf);
          return;
        }
        const j = await post({ action: "cashout" });
        if (j) endRef.current(j);
        else setError("Erreur réseau");
      } finally {
        isCashingOutRef.current = false;
        releaseLockRef.current = false;
      }
    },
    [cleanupGameLoop, post, tapFinal]
  );

  animateLoopRef.current = animateLoop;
  stopHoldLoopRef.current = stopHoldLoop;

  // ---------- Démarrage ----------
  const startGame = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setError("");
    setCrashShow(false);
    gaugeCardRef.current?.classList.remove("crashed");
    gaugeApi.current?.updateGauge(V_MIN);
    try {
      const bet = parseFloat(stake);
      if (Number.isNaN(bet) || bet <= 0) {
        setError("Mise invalide");
        return;
      }
      const j = await post({ action: "start_game", bet });
      if (j.status === "success") {
        roundIdRef.current = j.round_id ?? null;
        setBalFlashSoon(Number(j.new_balance));
        gBaseRef.current = typeof j.g_base === "number" && j.g_base > 0 ? j.g_base : gBaseRef.current;
        mMaxRef.current = typeof j.m_max === "number" && j.m_max > 0 ? j.m_max : mMaxRef.current;
        displayVRef.current = typeof j.multiplier === "number" ? j.multiplier : V_MIN;

        const betNorm = Number(j.bet_amount_display ?? bet);
        setStake(betNorm.toFixed(DEC));
        baseBetRef.current = betNorm;
        if (stakeDispRef.current) stakeDispRef.current.textContent = fmt(betNorm);
        if (payoutDispRef.current) payoutDispRef.current.textContent = fmt(betNorm * displayVRef.current);

        setMode("hold");
        gaugeApi.current?.updateGauge(displayVRef.current);
      } else {
        setError((j.message as string) || "Erreur");
      }
    } catch {
      setError("Erreur réseau ou critique");
    } finally {
      isStartingRef.current = false;
    }
  }, [post, setBalFlashSoon, stake]);

  // ---------- Slider / champ ----------
  const onSlider = useCallback(
    (pct: number) => {
      const safe = Math.max(0, Math.min(100, pct));
      const amount = MIN_BET + ((MAX_BET - MIN_BET) * safe) / 100;
      setStake(amount.toFixed(DEC));
      setSliderPct(safe);
    },
    []
  );

  const onStakeChange = useCallback(
    (raw: string) => {
      const val = parseFloat(raw);
      setStake(raw);
      if (Number.isNaN(val)) {
        setSliderPct(0);
        return;
      }
      const clamped = Math.min(MAX_BET, val);
      setStake(clamped.toFixed(DEC));
      setSliderPct(((clamped - MIN_BET) / (MAX_BET - MIN_BET)) * 100);
    },
    []
  );

  const onStakeBlur = useCallback(() => {
    let val = parseFloat(stake);
    if (Number.isNaN(val) || val < MIN_BET) {
      val = MIN_BET;
      setStake(val.toFixed(DEC));
      setSliderPct(0);
    }
  }, [stake]);

  // ---------- Événements globaux ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Enter" && modeRef.current === "start") {
        e.preventDefault();
        startGame();
      }
      if (e.code === "Space" && modeRef.current === "hold") {
        e.preventDefault();
        unlockAudio().then(() => startHoldLoop());
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && modeRef.current === "hold") {
        e.preventDefault();
        stopHoldLoop(false);
      }
    };
    const onVisibility = () => {
      if (document.hidden) stopHoldSound();
      if (document.hidden && modeRef.current === "hold" && roundIdRef.current) {
        stopHoldLoop(false);
      }
    };
    const onPointerUp = () => {
      if (holdingRef.current) stopHoldLoop(false);
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
  }, [startGame, startHoldLoop, stopHoldLoop, stopHoldSound, unlockAudio]);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ---------- Chargement initial ----------
  useEffect(() => {
    setMount(true);
    fetch("/api/accelerator")
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") {
          setBal(d.balance);
          setStake(Math.min(MIN_BET, d.balance).toFixed(DEC));
        }
      })
      .catch(() => undefined);
    setBalanceHidden(localStorage.getItem("acc_balance_hidden") === "true");
  }, []);

  const toggleBalance = () => {
    setBalanceHidden((h) => {
      localStorage.setItem("acc_balance_hidden", String(!h));
      return !h;
    });
  };

  const balText = balanceHidden ? "******" : fmt(bal).replace(SYM, "").trim();
  const isHold = mode === "hold";

  const holdButtonProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!isHold) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      unlockAudio().then(() => startHoldLoop());
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (isHold) {
        e.preventDefault();
        stopHoldLoop(false);
      }
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (isHold) {
        e.preventDefault();
        stopHoldLoop(false);
      }
    },
  };

  if (!mount) return null;

  return createPortal(
    <div className={s.acc}>
      <header className={s.header}>
        <div className={s.logo}>
          Accelerator <span>Pro</span>
        </div>
        <div className={s.headerRight}>
          <div className={s.balancePill}>
            <span className={s.amountHl} style={{ color: balFlash ? "#22C55E" : undefined }}>
              {balText}
            </span>
            <span>{SYM}</span>
            <button className={s.balanceToggle} onClick={toggleBalance} aria-label="Masquer le solde">
              {balanceHidden ? <EyeOff className="h-4 w-4" strokeWidth={2} /> : <Eye className="h-4 w-4" strokeWidth={2} />}
            </button>
          </div>
          <button className={s.btnIcon} onClick={() => setRulesOpen(true)} aria-label="Règles du jeu">
            <CircleHelp className="h-4 w-4" strokeWidth={2} />
          </button>
          <Link href="/matchs" className={s.btnIcon} title="Retour à l'accueil">
            <Trophy className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </header>

      <div className={s.layout}>
        <div className={s.colCenter}>
          <div className={s.pageGame}>
            <div className={s.matchBox}>
              <div className={s.gameCircleContainer}>
                <div className={s.gaugeCard} ref={gaugeCardRef}>
                  <div className={s.gbox}>
                    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet">
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
                      <path ref={railRef} fill="none" stroke="url(#railGradient)" strokeWidth={16} strokeLinecap="round" />
                      <g ref={sectorsRef} />
                      <g ref={ticksRef} />
                      <g ref={labelsRef} />
                      <g ref={needleRef}>
                        <polygon ref={needleShapeRef} fill="url(#needleGradient)" />
                        <circle cx={100} cy={100} r={5} fill="#0f172a" stroke="#cbd5e1" strokeWidth={1.5} />
                        <circle cx={100} cy={100} r={3} fill="url(#needleGradient)" />
                      </g>
                    </svg>
                  </div>
                  <div className={s.value} ref={valRef}>
                    1.01
                  </div>
                  <div className={s.payout}>
                    <span ref={stakeDispRef}>—</span>
                    <span>→</span>
                    <span className={s.gain} ref={payoutDispRef}>
                      —
                    </span>
                  </div>
                  <div className={`${s.crashBadge} ${crashShow ? s.show : ""}`}>CRASH ×{crashMult.toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className={s.mobileControlsPanel}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className={s.inputGroup}>
                  <input
                    type="number"
                    className={s.stakeIn}
                    placeholder="Mise"
                    min={MIN_BET}
                    max={MAX_BET}
                    step="0.01"
                    value={stake}
                    onChange={(e) => onStakeChange(e.target.value)}
                    onBlur={onStakeBlur}
                    disabled={isHold}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                  <span className={s.currencyBadge}>{SYM}</span>
                </div>
                <div className={s.rangeWrapper}>
                  <span className={s.rangeVal}>{Math.floor(sliderPct)}%</span>
                  <input
                    type="range"
                    className={s.betRange}
                    min={0}
                    max={100}
                    value={sliderPct}
                    step={1}
                    onChange={(e) => onSlider(parseFloat(e.target.value))}
                    disabled={isHold}
                    style={{ backgroundSize: `${sliderPct}% 100%` }}
                  />
                  <div className={s.rangeTicks}>
                    <div className={s.tickUi} data-val="0" />
                    <div className={s.tickUi} data-val="50" />
                    <div className={s.tickUi} data-val="MAX" />
                  </div>
                </div>
                <button
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
                      <Hand className="h-5 w-5" strokeWidth={2.4} /> MAINTENIR
                    </>
                  ) : (
                    <>
                      <Play className="h-5 w-5" strokeWidth={2.4} /> MISER
                    </>
                  )}
                </button>
                <div className={s.errorMsg}>{error}</div>
              </div>
            </div>
          </div>
        </div>

        <div className={s.colRight}>
          <div className={s.slipHead}>CONTRÔLES</div>
          <div className={s.slipBody}>
            <div className={s.inputGroup}>
              <input
                type="number"
                className={s.stakeIn}
                placeholder="Montant"
                min={MIN_BET}
                max={MAX_BET}
                step="0.01"
                value={stake}
                onChange={(e) => onStakeChange(e.target.value)}
                onBlur={onStakeBlur}
                disabled={isHold}
              />
              <span className={s.currencyBadge}>{SYM}</span>
            </div>
            <div className={s.limitInfo}>
              <span>
                Min: {MIN_BET} {SYM}
              </span>
              <span>
                Max: {MAX_BET} {SYM}
              </span>
            </div>
            <div className={s.rangeWrapper}>
              <span className={s.rangeVal}>{Math.floor(sliderPct)}%</span>
              <input
                type="range"
                className={s.betRange}
                min={0}
                max={100}
                value={sliderPct}
                step={1}
                onChange={(e) => onSlider(parseFloat(e.target.value))}
                disabled={isHold}
                style={{ backgroundSize: `${sliderPct}% 100%` }}
              />
              <div className={s.rangeTicks}>
                <div className={s.tickUi} data-val="0" />
                <div className={s.tickUi} data-val="50" />
                <div className={s.tickUi} data-val="MAX" />
              </div>
            </div>
          </div>
          <div className={s.slipFoot}>
            <button
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
                  <Hand className="h-5 w-5" strokeWidth={2.4} /> MAINTENIR
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" strokeWidth={2.4} /> MISER
                </>
              )}
            </button>
            <div className={s.errorMsg}>{error}</div>
          </div>
        </div>
      </div>

      {/* Modale résultat */}
      <div className={`${s.modalOverlay} ${modal.show ? s.show : ""}`} onClick={() => setModal((m) => ({ ...m, show: false }))}>
        <div className={`${s.modalV2} ${modal.win ? s.win : s.lose}`}>
          <div className={s.title}>{modal.title}</div>
          <div className={s.amount}>{modal.amount}</div>
          {modal.mult && <div style={{ color: "var(--gray)", fontWeight: 700 }}>Multiplicateur {modal.mult}</div>}
          <button className={s.btnCloseModal} onClick={() => setModal((m) => ({ ...m, show: false }))}>
            Fermer
          </button>
        </div>
      </div>

      {/* Modale règles */}
      <div className={`${s.modalOverlay} ${rulesOpen ? s.show : ""}`} onClick={() => setRulesOpen(false)}>
        <div className={s.modalV2} style={{ maxWidth: 460, textAlign: "left" }}>
          <div className={s.title} style={{ textAlign: "center" }}>
            Règles du jeu
          </div>
          <ul className={s.rulesText}>
            <li>Le multiplicateur monte de ×1.01 à ×2.00.</li>
            <li>Maintenez pour faire monter la jauge, relâchez pour encaisser.</li>
            <li>Gain = Mise × Multiplicateur au moment du cashout.</li>
            <li>Si le crash arrive avant, la mise est perdue.</li>
            <li>Provably Fair : chaque round est vérifiable via SHA-256.</li>
          </ul>
          <button className={s.btnCloseModal} onClick={() => setRulesOpen(false)}>
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
