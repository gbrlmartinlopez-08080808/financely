"use client";

import { useMemo } from "react";

interface Confetto {
  id: number;
  left: number;
  animationDuration: number;
  backgroundColor: string;
}

export default function ConfettiAnimation({ show }: { show: boolean }) {
  const confetti = useMemo(() => {
    if (!show) return [];
    
    const colors = [
      "#FF6B6B",
      "#4ECDC4",
      "#45B7D1",
      "#FFA07A",
      "#98D8C8",
      "#F7DC6F",
      "#BB8FCE",
      "#85C1E2",
    ];

    const newConfetti: Confetto[] = [];
    for (let i = 0; i < 50; i++) {
      newConfetti.push({
        id: i,
        left: (i * 2.5) % 100,
        animationDuration: 2 + (i % 3),
        backgroundColor: colors[i % colors.length],
      });
    }
    return newConfetti;
  }, [show]);

  if (!show || confetti.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {confetti.map((conf) => (
        <div
          key={conf.id}
          className="absolute w-2 h-2 rounded-sm animate-confetti-fall"
          style={{
            left: `${conf.left}%`,
            top: "-10px",
            backgroundColor: conf.backgroundColor,
            animationDuration: `${conf.animationDuration}s`,
            animationDelay: `${(conf.id % 10) * 0.05}s`,
          }}
        />
      ))}
    </div>
  );
}
