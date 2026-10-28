"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Eye, EyeOff, HandCoins, Play, Trophy } from "lucide-react";
import { useApp } from "@/components/providers";
import {
  formatLocalAmount,
  formatLocalInputString,
  localToEur,
  maxSpendableLocalFromEur,
  type CurrencyCode,
} from "@/lib/countries";
import { cn, eur } from "@/lib/format";
import s from "./tap-game.module.css";

const MAX_BET_EUR = 100;

interface Game {
  active: boolean;
  clicks: number;
  mult: number;
  bet: number;
}

interface ModalState {
  show: boolean;
  type: "win" | "lose";
  title: string;
  msg: string;
  amount: string;
  bet: number;
  mult: number;
}

interface Pop {
  id: number;
  x: number;
  y: number;
  rot: number;
}

interface ConfettiPiece {
  id: number;
  left: string;
  dur: string;
  col: string;
}

const emptySubscribe = () => () => {};

export default function TapPage() {
  const { currency, currencyConfig, setBalance } = useApp();
  const minBetLocal = currencyConfig.minStakeLocal;
  const maxBetLocal = Math.max(
    minBetLocal,
    maxSpendableLocalFromEur(MAX_BET_EUR, currency)
  );
  const fmt = useCallback(
    (eurAmount: number) => eur(eurAmount, currency),
    [currency]
  );

  const mount = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [bal, setBal] = useState(0);
  const [balanceHidden, setBalanceHidden] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("tap_balance_hidden") === "true" : false
  );
  const [balFlash, setBalFlash] = useState(false);
  const [game, setGame] = useState<Game>({ active: false, clicks: 0, mult: 1.0, bet: 0 });
  const [growth, setGrowth] = useState(1.05);
  const [locked, setLocked] = useState(false);
  const [clickAnim, setClickAnim] = useState(false);
  const [crashed, setCrashed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [prevCur, setPrevCur] = useState<CurrencyCode>(currency);
  const [stake, setStake] = useState(() =>
    formatLocalInputString(currencyConfig.stakePresets[0], currency, ".")
  );
  if (prevCur !== currency) {
    setPrevCur(currency);
    setStake(formatLocalInputString(currencyConfig.stakePresets[0], currency, "."));
  }
  const [sliderPct, setSliderPct] = useState(0);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalState>({
    show: false,
    type: "win",
    title: "",
    msg: "",
    amount: "",
    bet: 0,
    mult: 1.0,
  });
  const [pops, setPops] = useState<Pop[]>([]);
  const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);
  const [confVisible, setConfVisible] = useState(false);

  const gameRef = useRef(game);
  const activeRef = useRef(game.active);
  const multRef = useRef(game.mult);
  const balRef = useRef(bal);
  const pendingRef = useRef(0);
  const isSyncingRef = useRef(false);
  const lockRef = useRef(false);
  const lastPopRef = useRef(0);
  const popIdRef = useRef(0);
  const confIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const endRef = useRef<(d: { multiplier?: string | number; new_balance?: string | number; win_amount?: string | number }, win: boolean) => void>(() => {});

  const upGame = useCallback((patch: Partial<Game>) => {
    setGame((prev) => {
      const next = { ...prev, ...patch };
      gameRef.current = next;
      activeRef.current = next.active;
      multRef.current = next.mult;
      return next;
    });
  }, []);

  const playTap = () => {
    try {
      const c = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext());
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = 260 + Math.random() * 40;
      g.gain.setValueAtTime(0.12, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.08);
      o.connect(g);
      g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.09);
    } catch {
      /* audio indisponible */
    }
  };

  const playWin = () => {
    try {
      const c = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext());
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "triangle";
        o.frequency.value = f;
        const t = c.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g);
        g.connect(c.destination);
        o.start(t);
        o.stop(t + 0.55);
      });
    } catch {
      /* audio indisponible */
    }
  };

  const playLose = () => {
    try {
      const c = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext());
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(220, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(110, c.currentTime + 0.5);
      g.gain.setValueAtTime(0.12, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
      o.connect(g);
      g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.65);
    } catch {
      /* audio indisponible */
    }
  };

  const showModal = (type: "win" | "lose", title: string, amount: string) => {
    setModal({
      show: true,
      type,
      title,
      msg: type === "win" ? "Félicitations" : "Dommage",
      amount,
      bet: gameRef.current.bet,
      mult: gameRef.current.mult,
    });
  };

  const closeModal = () => setModal((m) => ({ ...m, show: false }));

  const fireConfetti = () => {
    const cols = ["#f9a602", "#ffd700", "#e74c3c", "#2ecc71", "#3498db"];
    setConfetti(
      Array.from({ length: 30 }, () => ({
        id: ++confIdRef.current,
        left: Math.random() * 100 + "%",
        dur: Math.random() * 2 + 2 + "s",
        col: cols[Math.floor(Math.random() * cols.length)],
      }))
    );
    setConfVisible(true);
    setTimeout(() => setConfVisible(false), 4000);
  };

  const addPop = (x: number, y: number) => {
    const id = ++popIdRef.current;
    setPops((p) => [...p.slice(-14), { id, x, y, rot: (Math.random() - 0.5) * 40 }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 500);
  };

  const end = useCallback(
    (
      d: { multiplier?: string | number; new_balance?: string | number; win_amount?: string | number },
      win: boolean
    ) => {
      upGame({ active: false });
      pendingRef.current = 0;
      lockRef.current = false;
      setLocked(false);
      if (d.multiplier !== undefined) upGame({ mult: parseFloat(String(d.multiplier)) });
      if (d.new_balance !== undefined) {
        const nb = parseFloat(String(d.new_balance));
        setBal(nb);
        setBalance(nb);
      }

      if (win) {
        fireConfetti();
        showModal("win", "Encaissé !", "Gain : " + fmt(Number(d.win_amount)));
      } else {
        playLose();
        setCrashed(true);
        showModal(
          "lose",
          gameRef.current.bet > 10 ? "Aïe, ça pique..." : "Crashed !",
          "Perte : " + fmt(gameRef.current.bet)
        );
      }
      setTimeout(() => {
        setCrashed(false);
        setLoading(false);
        setPlaying(false);
        upGame({ mult: 1.0, bet: 0 });
      }, 1500);
    },
    [fmt, setBalance, upGame]
  );

  useEffect(() => {
    gameRef.current = game;
    activeRef.current = game.active;
    multRef.current = game.mult;
    balRef.current = bal;
    endRef.current = end;
  }, [bal, end, game]);

  const getBounds = () => {
    const spendable = maxSpendableLocalFromEur(balRef.current, currency);
    const effectiveMax = Math.max(minBetLocal, Math.min(spendable, maxBetLocal));
    return { min: minBetLocal, max: effectiveMax };
  };

  const clampPct = (n: number) => Math.max(0, Math.min(100, n));

  const formatLocalStake = (amount: number) =>
    currencyConfig.decimals === 0
      ? String(Math.round(amount))
      : amount.toFixed(2);

  const onSliderChange = (percent: number) => {
    const b = getBounds();
    let amount = b.min + ((b.max - b.min) * percent) / 100;
    if (percent === 100) amount = b.max;
    if (percent === 0) amount = b.min;
    setStake(formatLocalStake(amount));
    setSliderPct(clampPct(percent));
  };

  const onStakeChange = (val: string) => {
    setStake(val);
    if (val === "") {
      setSliderPct(0);
      return;
    }
    const num = parseFloat(val);
    const b = getBounds();
    if (!isNaN(num) && num > b.max) {
      setStake(formatLocalStake(b.max));
      setSliderPct(100);
      return;
    }
    let pct: number;
    if (isNaN(num)) pct = 0;
    else {
      const range = b.max - b.min;
      pct = range <= 0 ? (num >= b.max ? 100 : 0) : ((num - b.min) / range) * 100;
    }
    setSliderPct(clampPct(pct));
  };

  const onStakeBlur = () => {
    const num = parseFloat(stake);
    const b = getBounds();
    if (isNaN(num) || num < b.min) {
      setStake(formatLocalStake(b.min));
      setSliderPct(0);
    }
  };

  const start = async () => {
    if (isSyncingRef.current) return;
    const localAmt = parseFloat(stake);
    if (isNaN(localAmt) || localAmt <= 0) {
      setError("Mise invalide");
      return;
    }
    if (localAmt < minBetLocal) {
      setError(`Mise minimale : ${formatLocalAmount(minBetLocal, currency)}`);
      setStake(formatLocalStake(minBetLocal));
      setSliderPct(0);
      return;
    }
    const amt = localToEur(localAmt, currency, balRef.current);
    isSyncingRef.current = true;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_game", bet: amt }),
      });
      const d = await res.json();
      if (d.status === "success") {
        const nb = parseFloat(d.new_balance);
        setBal(nb);
        setBalance(nb);
        pendingRef.current = 0;
        lockRef.current = false;
        setLocked(false);
        setCrashed(false);
        if (d.factor) setGrowth(parseFloat(d.factor));
        upGame({ active: true, clicks: 0, mult: parseFloat(d.multiplier), bet: amt });
        setLoading(false);
        setPlaying(true);
      } else {
        setError(d.message || "Erreur");
        setLoading(false);
      }
    } catch {
      setError("Erreur réseau");
      setLoading(false);
    }
    isSyncingRef.current = false;
  };

  const cashout = async () => {
    if (!activeRef.current || isSyncingRef.current) return;
    isSyncingRef.current = true;
    playWin();
    try {
      const res = await fetch("/api/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cashout" }),
      });
      const d = await res.json();
      if (d.status === "success") endRef.current(d, true);
      else {
        if (d.message === "Jeu inactif") endRef.current({ multiplier: multRef.current }, false);
        else setError(d.message);
      }
    } catch {
      /* silencieux */
    }
    isSyncingRef.current = false;
  };

  const action = () => {
    if (activeRef.current) cashout();
    else start();
  };

  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeRef.current) return;
    if (lockRef.current) return;

    playTap();
    const now = Date.now();
    if (now - lastPopRef.current > 80) {
      lastPopRef.current = now;
      addPop(e.clientX, e.clientY);
    }
    setClickAnim(false);
    requestAnimationFrame(() => setClickAnim(true));

    pendingRef.current++;
    const newClicks = gameRef.current.clicks + 1;
    const newMult = Math.floor(1.0 * Math.pow(growth, newClicks) * 100) / 100;
    upGame({ clicks: newClicks, mult: newMult });

    lockRef.current = true;
    setLocked(true);
    setTimeout(() => {
      if (activeRef.current) {
        lockRef.current = false;
        setLocked(false);
      }
    }, 1000);
  };

  // Chargement initial + préférence visibilité du solde
  useEffect(() => {
    fetch("/api/tap")
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") {
          setBal(d.balance);
        }
      })
      .catch(() => undefined);
  }, []);

  // Synchronisation des clics avec le serveur (batch toutes les 300 ms)
  useEffect(() => {
    const id = setInterval(async () => {
      if (!activeRef.current || pendingRef.current === 0 || isSyncingRef.current) return;
      isSyncingRef.current = true;
      const count = pendingRef.current;
      pendingRef.current = 0;
      try {
        const res = await fetch("/api/tap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tap_batch", count }),
        });
        const d = await res.json();
        if (d.status === "crashed") endRef.current(d, false);
        else if (d.status === "autocashout") endRef.current(d, true);
        else if (d.status === "ok") {
          const sM = parseFloat(d.multiplier);
          if (Math.abs(sM - multRef.current) > 0.1) upGame({ mult: sM });
        }
      } catch {
        pendingRef.current += count;
      }
      isSyncingRef.current = false;
    }, 300);
    return () => clearInterval(id);
  }, [upGame]);

  // Rafraîchissement du solde hors partie (5 s)
  useEffect(() => {
    const id = setInterval(async () => {
      if (activeRef.current) return;
      try {
        const res = await fetch("/api/tap");
        const d = await res.json();
        if (d.status === "success" && Math.abs(balRef.current - d.balance) > 0.00001) {
          setBal(d.balance);
          setBalFlash(true);
          setTimeout(() => setBalFlash(false), 500);
        }
      } catch {
        /* silencieux */
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const toggleBalance = () => {
    setBalanceHidden((h) => {
      localStorage.setItem("tap_balance_hidden", String(!h));
      return !h;
    });
  };

  const balText = balanceHidden ? "******" : fmt(bal);
  const btnText = playing ? " ENCAISSER" : " JOUER";

  if (!mount) return null;

  return createPortal(
    <div className={s.tap}>
      <header className={s.header}>
        <div className={s.logo}>
          Tap <span>Win</span>
        </div>
        <div className={s.headerRight}>
          <div className={s.balancePill}>
            <span className={s.amountHl} style={{ color: balFlash ? "#22C55E" : undefined }}>
              {balText}
            </span>
            <button className={s.balanceToggle} onClick={toggleBalance} aria-label="Masquer le solde">
              {balanceHidden ? (
                <EyeOff className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={2} />
              )}
            </button>
          </div>
          <Link href="/predictions" className={s.btnIcon} title="Retour à l'accueil">
            <Trophy className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      </header>

      <div className={s.layout}>
        <div className={s.colCenter}>
          <div className={s.pageGame}>
            <div className={s.matchBox}>
              <div className={s.gameCircleContainer}>
                <div className={s.outerRing} />
                <div
                  className={cn(s.circle, crashed && s.crashed, locked && s.locked, clickAnim && s.clickAnim)}
                  onClick={handleTap}
                  onAnimationEnd={() => setClickAnim(false)}
                >
                  <div className={s.multiplierDisplay}>x{game.mult.toFixed(2)}</div>
                  <div className={s.gainLabel}>Gain actuel</div>
                  <div className={s.gainValue}>{fmt(game.bet * game.mult)}</div>
                </div>
              </div>
            </div>

            <div className={s.mobileControlsPanel}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <StakeControl
                  s={s}
                  stake={stake}
                  sliderPct={sliderPct}
                  onStake={onStakeChange}
                  onBlur={onStakeBlur}
                  onSlider={onSliderChange}
                  disabled={playing}
                  minBetLocal={minBetLocal}
                  maxBetLocal={maxBetLocal}
                  currency={currency}
                  symbol={currencyConfig.symbol}
                  decimals={currencyConfig.decimals}
                />
                <button
                  className={cn(s.btnPlace, playing && s.btnCashout)}
                  onClick={action}
                  disabled={loading && !playing}
                >
                  {playing ? <HandCoins className="h-5 w-5" strokeWidth={2.2} /> : <Play className="h-5 w-5" strokeWidth={2.2} />}
                  {btnText}
                </button>
                <div className={s.errorMsg}>{error}</div>
              </div>
            </div>
          </div>
        </div>

        <div className={s.colRight}>
          <div className={s.slipHead}>
            <span>CONTRÔLES</span>
          </div>
          <div className={s.slipBody}>
            <StakeControl
              s={s}
              stake={stake}
              sliderPct={sliderPct}
              onStake={onStakeChange}
              onBlur={onStakeBlur}
              onSlider={onSliderChange}
              disabled={playing}
              minBetLocal={minBetLocal}
              maxBetLocal={maxBetLocal}
              currency={currency}
              symbol={currencyConfig.symbol}
              decimals={currencyConfig.decimals}
            />
          </div>
          <div className={s.slipFoot}>
            <button
              className={cn(s.btnPlace, playing && s.btnCashout)}
              onClick={action}
              disabled={loading && !playing}
            >
              {playing ? <HandCoins className="h-5 w-5" strokeWidth={2.2} /> : <Play className="h-5 w-5" strokeWidth={2.2} />}
              {btnText}
            </button>
            <div className={s.errorMsg}>{error}</div>
          </div>
        </div>
      </div>

      <div className={cn(s.modalOverlay, modal.show && s.show)}>
        <div className={cn(s.modal, modal.type === "win" && s.modalWin, modal.type === "lose" && s.modalLose)}>
          <div className={s.modalTitle}>{modal.title}</div>
          <div className={s.modalMsg}>{modal.msg}</div>
          <div className={s.modalDetails}>
            <div className={s.detailRow}>
              <span className={s.detailLabel}>Mise :</span>
              <span className={s.detailValue}>{fmt(modal.bet)}</span>
            </div>
            <div className={s.detailRow}>
              <span className={s.detailLabel}>Multiplicateur :</span>
              <span className={cn(s.detailValue, s.detailMult)}>x{modal.mult.toFixed(2)}</span>
            </div>
          </div>
          <div className={s.modalAmount}>{modal.amount}</div>
          <button className={s.btnCloseModal} onClick={closeModal}>
            Fermer
          </button>
        </div>
      </div>

      <div className={cn(s.confettiContainer, confVisible && s.confettiVisible)}>
        {confetti.map((p) => (
          <div
            key={p.id}
            className={s.confetti}
            style={{ left: p.left, top: "-10%", backgroundColor: p.col, animationDuration: p.dur }}
          />
        ))}
      </div>

      {pops.map((p) => (
        <div
          key={p.id}
          className={s.tapPop}
          style={{ left: p.x, top: p.y, transform: `translate(-50%,-50%) rotate(${p.rot}deg)` }}
        >
          +1
        </div>
      ))}
    </div>,
    document.body
  );
}

function StakeControl({
  s,
  stake,
  sliderPct,
  onStake,
  onBlur,
  onSlider,
  disabled,
  minBetLocal,
  maxBetLocal,
  currency,
  symbol,
  decimals,
}: {
  s: Record<string, string>;
  stake: string;
  sliderPct: number;
  onStake: (val: string) => void;
  onBlur: () => void;
  onSlider: (pct: number) => void;
  disabled: boolean;
  minBetLocal: number;
  maxBetLocal: number;
  currency: CurrencyCode;
  symbol: string;
  decimals: 0 | 2;
}) {
  return (
    <>
      <div className={s.inputGroup}>
        <input
          type="number"
          className={s.stakeIn}
          placeholder="Mise"
          min={minBetLocal}
          max={maxBetLocal}
          step={decimals === 0 ? "50" : "0.01"}
          value={stake}
          onChange={(e) => onStake(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          inputMode={decimals === 0 ? "numeric" : "decimal"}
        />
        <span className={s.currencyBadge}>{symbol}</span>
      </div>

      <div className={s.limitInfo}>
        <span>Min: {formatLocalAmount(minBetLocal, currency)}</span>
        <span>Max: {formatLocalAmount(maxBetLocal, currency)}</span>
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
          disabled={disabled}
          style={{ backgroundSize: `${sliderPct}% 100%` }}
        />
        <div className={s.rangeTicks}>
          <div className={s.tick} data-val="0" />
          <div className={s.tick} />
          <div className={s.tick} data-val="50" />
          <div className={s.tick} />
          <div className={s.tick} data-val="MAX" />
        </div>
      </div>
    </>
  );
}
