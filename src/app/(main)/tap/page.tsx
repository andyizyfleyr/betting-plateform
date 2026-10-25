"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, HandCoins, Play } from "lucide-react";
import { cn } from "@/lib/format";
import s from "./tap-game.module.css";

const SYM = "$";
const DEC = 2;
const MIN_BET = 1;
const MAX_BET = 100;
const QUICK_BETS = [1, 5, 10, 25];

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
  amount: string;
  bet: number;
  mult: number;
}

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

const emptySubscribe = () => () => {};

export default function TapPage() {
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
  const [stake, setStake] = useState("1.00");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalState>({
    show: false,
    type: "win",
    title: "",
    amount: "",
    bet: 0,
    mult: 1.0,
  });

  const gameRef = useRef(game);
  const activeRef = useRef(game.active);
  const multRef = useRef(game.mult);
  const balRef = useRef(bal);
  const pendingRef = useRef(0);
  const isSyncingRef = useRef(false);
  const lockRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const endRef = useRef<
    (
      d: { multiplier?: string | number; new_balance?: string | number; win_amount?: string | number },
      win: boolean
    ) => void
  >(() => {});

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
      if (d.new_balance !== undefined) setBal(parseFloat(String(d.new_balance)));

      if (win) {
        setModal({
          show: true,
          type: "win",
          title: "Encaissé !",
          amount: "+" + fmt(Number(d.win_amount)),
          bet: gameRef.current.bet,
          mult: gameRef.current.mult,
        });
      } else {
        playLose();
        setCrashed(true);
        setModal({
          show: true,
          type: "lose",
          title: "Perdu",
          amount: "−" + fmt(gameRef.current.bet),
          bet: gameRef.current.bet,
          mult: gameRef.current.mult,
        });
      }
      setTimeout(() => {
        setCrashed(false);
        setLoading(false);
        setPlaying(false);
        upGame({ mult: 1.0, bet: 0, clicks: 0 });
      }, 1200);
    },
    [upGame]
  );

  useEffect(() => {
    gameRef.current = game;
    activeRef.current = game.active;
    multRef.current = game.mult;
    balRef.current = bal;
    endRef.current = end;
  }, [bal, end, game]);

  const setQuickStake = (val: number) => {
    const effectiveMax = Math.max(MIN_BET, Math.min(balRef.current || MAX_BET, MAX_BET));
    const clamped = Math.max(MIN_BET, Math.min(effectiveMax, val));
    setStake(clamped.toFixed(DEC));
    setError("");
  };

  const onStakeBlur = () => {
    const effectiveMax = Math.max(MIN_BET, Math.min(balRef.current || MAX_BET, MAX_BET));
    let num = parseFloat(stake.replace(",", "."));
    if (Number.isNaN(num) || num < MIN_BET) num = MIN_BET;
    if (num > effectiveMax) num = effectiveMax;
    setStake(num.toFixed(DEC));
  };

  const start = async () => {
    if (isSyncingRef.current) return;
    const amt = parseFloat(stake.replace(",", "."));
    if (Number.isNaN(amt) || amt <= 0) {
      setError("Mise invalide");
      return;
    }
    if (amt < MIN_BET) {
      setError(`Mise minimale : ${MIN_BET} ${SYM}`);
      setStake(MIN_BET.toFixed(DEC));
      return;
    }
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
        setBal(parseFloat(d.new_balance));
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
      else if (d.message === "Jeu inactif") endRef.current({ multiplier: multRef.current }, false);
      else setError(d.message);
    } catch {
      /* silencieux */
    }
    isSyncingRef.current = false;
  };

  const handleTap = () => {
    if (!activeRef.current || lockRef.current) return;
    playTap();
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

  useEffect(() => {
    fetch("/api/tap")
      .then((r) => r.json())
      .then((d) => {
        if (d.status === "success") {
          setBal(d.balance);
          setStake(Math.max(MIN_BET, Math.min(MIN_BET, d.balance)).toFixed(DEC));
        }
      })
      .catch(() => undefined);
  }, []);

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

  useEffect(() => {
    const id = setInterval(async () => {
      if (activeRef.current || (typeof document !== "undefined" && document.hidden)) return;
      try {
        const res = await fetch("/api/tap");
        const d = await res.json();
        if (d.status === "success" && Math.abs(balRef.current - d.balance) > 0.01) {
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

  const balText = balanceHidden ? "••••" : fmt(bal);

  if (!mount) return null;

  return createPortal(
    <div className={s.tap}>
      <div className={s.shell}>
        <header className={s.header}>
          <div className={s.headerLeft}>
            <Link href="/predictions" className={s.btnIcon} aria-label="Retour">
              <ArrowLeft className="h-4 w-4" strokeWidth={2.3} />
            </Link>
            <div className={s.logo}>
              Tap <span>Win</span>
            </div>
          </div>

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
        </header>

        <main className={s.stage}>
          <button
            type="button"
            onPointerDown={handleTap}
            onAnimationEnd={() => setClickAnim(false)}
            disabled={!playing || locked}
            className={cn(
              s.circle,
              playing && s.circleActive,
              crashed && s.crashed,
              locked && s.locked,
              clickAnim && s.clickAnim
            )}
          >
            <span className={s.multiplierDisplay}>×{game.mult.toFixed(2)}</span>
            <span className={s.gainLabel}>{playing ? "Gain actuel" : "En attente"}</span>
            <span className={s.gainValue}>{playing ? fmt(game.bet * game.mult) : "—"}</span>
          </button>

          <p className={s.hint}>
            {playing
              ? locked
                ? "Patientez 1 seconde avant le prochain tap…"
                : "Touchez le cercle pour grimper ou encaissez vos gains"
              : "Définissez votre mise (1 $ à 100 $) puis lancez la partie"}
          </p>
        </main>

        <section className={s.controls}>
          <div className={s.inputGroup}>
            <input
              type="text"
              inputMode="decimal"
              className={s.stakeIn}
              placeholder="Mise"
              value={stake}
              onChange={(e) => setStake(e.target.value.replace(/[^0-9.,]/g, ""))}
              onBlur={onStakeBlur}
              disabled={playing}
              aria-label="Montant de la mise"
            />
            <span className={s.currencyBadge}>{SYM}</span>
          </div>

          <div className={s.quickGrid}>
            {QUICK_BETS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={playing}
                onClick={() => setQuickStake(q)}
                className={s.quickBtn}
              >
                {q} {SYM}
              </button>
            ))}
            <button
              type="button"
              disabled={playing}
              onClick={() => setQuickStake(MAX_BET)}
              className={cn(s.quickBtn, s.quickMax)}
            >
              MAX
            </button>
          </div>

          <button
            type="button"
            className={cn(s.btnPlace, playing && s.btnCashout)}
            onClick={() => (playing ? cashout() : start())}
            disabled={loading && !playing}
          >
            {playing ? (
              <>
                <HandCoins className="h-5 w-5" strokeWidth={2.2} />
                ENCAISSER · {fmt(game.bet * game.mult)}
              </>
            ) : (
              <>
                <Play className="h-5 w-5" strokeWidth={2.2} />
                JOUER
              </>
            )}
          </button>

          {error && <div className={s.errorMsg}>{error}</div>}
        </section>

        {/* Modale résultat */}
        <div
          className={cn(s.modalOverlay, modal.show && s.show)}
          onClick={() => setModal((m) => ({ ...m, show: false }))}
        >
          <div
            className={cn(
              s.modal,
              modal.type === "win" && s.modalWin,
              modal.type === "lose" && s.modalLose
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={s.modalTitle}>{modal.title}</div>
            <div className={s.modalAmount}>{modal.amount}</div>
            <div className={s.modalDetails}>
              <div className={s.detailRow}>
                <span>Mise</span>
                <strong>{fmt(modal.bet)}</strong>
              </div>
              <div className={s.detailRow}>
                <span>Multiplicateur</span>
                <strong className={s.detailMult}>×{modal.mult.toFixed(2)}</strong>
              </div>
            </div>
            <button
              type="button"
              className={s.btnCloseModal}
              onClick={() => setModal((m) => ({ ...m, show: false }))}
            >
              Continuer
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
