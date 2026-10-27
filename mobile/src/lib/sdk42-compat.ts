import React from "react";
import { StyleSheet, View } from "react-native";

/**
 * Compatibilité complète Flexbox `gap` / `rowGap` / `columnGap` pour React Native 0.64
 * (Expo Go SDK 42 Android) :
 * 1. Intercepte `StyleSheet.create` pour extraire `gap` / `rowGap` / `columnGap` avant
 *    `StyleSheetValidation` (0 avertissement / 0 RedBox).
 * 2. Injecte automatiquement l'espacement exact entre les enfants de flux des `<View>`
 *    (y compris l'intérieur des `<Pressable>` et `<ScrollView contentContainerStyle>`).
 */

interface GapMeta {
  rowGap: number;
  columnGap: number;
}

const gapRegistry = new WeakMap<object, GapMeta>();
let installed = false;

function extractGapFromRule(rule: Record<string, unknown>): GapMeta | null {
  const g = typeof rule.gap === "number" ? rule.gap : undefined;
  const rg = typeof rule.rowGap === "number" ? rule.rowGap : g;
  const cg = typeof rule.columnGap === "number" ? rule.columnGap : g;

  if (g === undefined && rg === undefined && cg === undefined) {
    return null;
  }

  delete rule.gap;
  delete rule.rowGap;
  delete rule.columnGap;

  return {
    rowGap: rg ?? 0,
    columnGap: cg ?? 0,
  };
}

interface ResolvedContainerLayout {
  rowGap: number;
  columnGap: number;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
}

function resolveStyleTree(
  styleProp: unknown,
  acc: ResolvedContainerLayout
): boolean {
  if (!styleProp) return false;

  if (Array.isArray(styleProp)) {
    let mutated = false;
    for (let i = 0; i < styleProp.length; i++) {
      if (resolveStyleTree(styleProp[i], acc)) mutated = true;
    }
    return mutated;
  }

  if (typeof styleProp === "object") {
    const obj = styleProp as Record<string, unknown>;
    const registered = gapRegistry.get(obj);
    if (registered) {
      acc.rowGap = registered.rowGap;
      acc.columnGap = registered.columnGap;
    } else if (
      "gap" in obj ||
      "rowGap" in obj ||
      "columnGap" in obj
    ) {
      // Style inline `{ gap: 8 }` : clone propre sans muter un objet potentiellement gelé
      if (!Object.isFrozen(obj)) {
        const inlineGap = extractGapFromRule(obj);
        if (inlineGap) {
          gapRegistry.set(obj, inlineGap);
          acc.rowGap = inlineGap.rowGap;
          acc.columnGap = inlineGap.columnGap;
        }
      } else {
        const g = typeof obj.gap === "number" ? obj.gap : undefined;
        acc.rowGap = typeof obj.rowGap === "number" ? obj.rowGap : (g ?? acc.rowGap);
        acc.columnGap =
          typeof obj.columnGap === "number" ? obj.columnGap : (g ?? acc.columnGap);
        return true;
      }
    }

    if (typeof obj.flexDirection === "string") acc.flexDirection = obj.flexDirection;
    if (typeof obj.flexWrap === "string") acc.flexWrap = obj.flexWrap;
    if (typeof obj.justifyContent === "string") acc.justifyContent = obj.justifyContent;
  }

  return false;
}

function sanitizeFrozenInlineStyle(styleProp: unknown): unknown {
  if (!styleProp) return styleProp;
  if (Array.isArray(styleProp)) {
    return styleProp.map(sanitizeFrozenInlineStyle);
  }
  if (
    typeof styleProp === "object" &&
    ("gap" in (styleProp as Record<string, unknown>) ||
      "rowGap" in (styleProp as Record<string, unknown>) ||
      "columnGap" in (styleProp as Record<string, unknown>))
  ) {
    const clone = { ...(styleProp as Record<string, unknown>) };
    const meta = extractGapFromRule(clone);
    if (meta) gapRegistry.set(clone, meta);
    return clone;
  }
  return styleProp;
}

function isOutOfFlowElement(el: React.ReactNode): boolean {
  if (!React.isValidElement(el)) return false;
  const typeAny = el.type as { name?: string; displayName?: string } | string;
  const typeName =
    typeof typeAny === "string"
      ? typeAny
      : typeAny?.displayName || typeAny?.name || "";

  if (
    typeName === "PressabilityDebugView" ||
    typeName === "OddsTrendCorner" ||
    typeName === "Redirect"
  ) {
    return true;
  }

  const childProps = el.props as { style?: unknown } | undefined;
  if (childProps?.style) {
    const flat = StyleSheet.flatten(childProps.style as never) as
      | Record<string, unknown>
      | undefined;
    if (flat?.position === "absolute") return true;
  }
  return false;
}

export function installSdk42Compat(): void {
  if (installed) return;
  installed = true;

  const origCreate = StyleSheet.create.bind(StyleSheet);
  (StyleSheet as unknown as { create: (styles: any) => any }).create = (
    styles: Record<string, Record<string, unknown>>
  ) => {
    const pending = new Map<string, GapMeta>();
    const cleaned: Record<string, Record<string, unknown>> = {};

    for (const key of Object.keys(styles)) {
      const rawRule = styles[key];
      if (rawRule && typeof rawRule === "object") {
        const copy = { ...rawRule };
        const meta = extractGapFromRule(copy);
        if (meta) pending.set(key, meta);
        cleaned[key] = copy;
      } else {
        cleaned[key] = rawRule;
      }
    }

    const created = origCreate(cleaned as never) as Record<string, unknown>;
    for (const [key, meta] of pending.entries()) {
      const ruleObj = created[key];
      if (ruleObj && typeof ruleObj === "object") {
        gapRegistry.set(ruleObj, meta);
      }
    }
    return created;
  };

  const origCreateElement = React.createElement;

  (React as unknown as { createElement: typeof React.createElement }).createElement =
    function patchedCreateElement(
      type: any,
      props: any,
      ...children: any[]
    ): any {
      if (type === View && props && props.style) {
        const layout: ResolvedContainerLayout = {
          rowGap: 0,
          columnGap: 0,
          flexDirection: "column",
          flexWrap: "nowrap",
          justifyContent: "flex-start",
        };

        const hadFrozenGap = resolveStyleTree(props.style, layout);
        const nextProps = hadFrozenGap
          ? { ...props, style: sanitizeFrozenInlineStyle(props.style) }
          : props;

        if (
          (layout.rowGap > 0 || layout.columnGap > 0) &&
          children.length > 0 &&
          typeof children[0] !== "function"
        ) {
          const arr = React.Children.toArray(children);
          if (arr.length > 0) {
            const isRow =
              layout.flexDirection === "row" ||
              layout.flexDirection === "row-reverse";
            const isWrap = layout.flexWrap === "wrap";

            if (isRow && isWrap) {
              const isSpaceBetween = layout.justifyContent === "space-between";
              const wrapped = arr.map((child, idx) => {
                if (isOutOfFlowElement(child)) return child;
                const spacingStyle = isSpaceBetween
                  ? { marginBottom: layout.rowGap }
                  : {
                      marginRight: layout.columnGap,
                      marginBottom: layout.rowGap,
                    };
                if (React.isValidElement(child) && child.type === View) {
                  const cp = child.props as { style?: unknown };
                  return React.cloneElement(child as React.ReactElement<any>, {
                    style: cp.style ? [spacingStyle, cp.style] : spacingStyle,
                  });
                }
                return origCreateElement(
                  View,
                  { key: `__gw_${idx}`, style: spacingStyle },
                  child
                );
              });
              return origCreateElement(type, nextProps, ...wrapped);
            }

            const gapPx = isRow ? layout.columnGap : layout.rowGap;
            const skipDistribute =
              layout.justifyContent === "space-around" ||
              layout.justifyContent === "space-evenly";

            if (gapPx > 0 && !skipDistribute) {
              const flowIndices: number[] = [];
              for (let i = 0; i < arr.length; i++) {
                if (!isOutOfFlowElement(arr[i])) flowIndices.push(i);
              }

              const allowInterleave =
                layout.justifyContent !== "space-between" ||
                (isRow && flowIndices.length === 2);

              if (allowInterleave && flowIndices.length > 1) {
                const spacerStyle = isRow
                  ? { width: gapPx, flexShrink: 0 }
                  : { height: gapPx, flexShrink: 0 };
                const spaced: React.ReactNode[] = [];
                let seenFlow = 0;

                for (let i = 0; i < arr.length; i++) {
                  const child = arr[i];
                  if (!isOutOfFlowElement(child)) {
                    if (seenFlow > 0) {
                      spaced.push(
                        origCreateElement(View, {
                          key: `__gs_${i}`,
                          pointerEvents: "none",
                          style: spacerStyle,
                        })
                      );
                    }
                    seenFlow++;
                  }
                  spaced.push(child);
                }

                return origCreateElement(type, nextProps, ...spaced);
              }
            }
          }
        }

        if (hadFrozenGap) {
          return origCreateElement(type, nextProps, ...children);
        }
      }

      return origCreateElement(type, props, ...children);
    };
}

installSdk42Compat();
