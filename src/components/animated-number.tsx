"use client";

import { useEffect, useRef } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

/** Nombre qui glisse en douceur vers sa nouvelle valeur. */
export function AnimatedNumber({
  value,
  format = (n: number) => n.toFixed(0),
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const spring = useSpring(value, { stiffness: 90, damping: 22 });
  const display = useTransform(spring, (v) => format(v));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      spring.jump(value);
      return;
    }
    spring.set(value);
  }, [value, spring]);

  return <motion.span className={className}>{display}</motion.span>;
}
