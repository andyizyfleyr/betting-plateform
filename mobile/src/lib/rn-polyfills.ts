// Polyfills WinterCG / DOM indispensables pour React Native + Hermes en APK Release (`newArchEnabled=false`).
// Doit être importé avant `partysocket` et avant le montage de l'arbre racine `App`.
import "partysocket/event-target-polyfill";

const g = globalThis as Record<string, unknown>;

const BaseEvent = g.Event as {
  new (type: string, eventInitDict?: Record<string, unknown>): {
    type: string;
    bubbles: boolean;
    cancelable: boolean;
    composed: boolean;
  };
};

if (typeof BaseEvent === "function") {
  if (typeof g.MessageEvent === "undefined") {
    class PolyfillMessageEvent extends BaseEvent {
      data: unknown;
      origin: string;
      lastEventId: string;
      source: unknown;
      ports: unknown[];

      constructor(type: string, init?: Record<string, unknown>) {
        super(type, init);
        this.data = init?.data ?? null;
        this.origin = typeof init?.origin === "string" ? init.origin : "";
        this.lastEventId =
          typeof init?.lastEventId === "string" ? init.lastEventId : "";
        this.source = init?.source ?? null;
        this.ports = Array.isArray(init?.ports) ? init.ports : [];
      }
    }
    g.MessageEvent = PolyfillMessageEvent;
  }

  if (typeof g.CustomEvent === "undefined") {
    class PolyfillCustomEvent extends BaseEvent {
      detail: unknown;

      constructor(type: string, init?: Record<string, unknown>) {
        super(type, init);
        this.detail = init?.detail ?? null;
      }
    }
    g.CustomEvent = PolyfillCustomEvent;
  }

  if (typeof g.CloseEvent === "undefined") {
    class PolyfillCloseEvent extends BaseEvent {
      code: number;
      reason: string;
      wasClean: boolean;

      constructor(type: string, init?: Record<string, unknown>) {
        super(type, init);
        this.code = typeof init?.code === "number" ? init.code : 1000;
        this.reason = typeof init?.reason === "string" ? init.reason : "";
        this.wasClean =
          typeof init?.wasClean === "boolean" ? init.wasClean : true;
      }
    }
    g.CloseEvent = PolyfillCloseEvent;
  }

  if (typeof g.ErrorEvent === "undefined") {
    class PolyfillErrorEvent extends BaseEvent {
      message: string;
      error: unknown;

      constructor(type: string, init?: Record<string, unknown>) {
        super(type, init);
        this.message = typeof init?.message === "string" ? init.message : "";
        this.error = init?.error ?? null;
      }
    }
    g.ErrorEvent = PolyfillErrorEvent;
  }
}

function fallbackRandomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

if (typeof g.crypto === "undefined" || g.crypto === null) {
  g.crypto = {
    randomUUID: fallbackRandomUuid,
  };
} else if (
  typeof g.crypto === "object" &&
  typeof (g.crypto as { randomUUID?: unknown }).randomUUID !== "function"
) {
  try {
    (g.crypto as { randomUUID?: () => string }).randomUUID = fallbackRandomUuid;
  } catch {
    // Objet crypto non extensible sur certains moteurs : ignoré proprement
  }
}
