"use client";

import { useEffect, useState } from "react";

interface StreakCounterProps {
  streak: number;
  size?: "small" | "medium" | "large";
}

export default function StreakCounter({ streak, size = "medium" }: StreakCounterProps) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (streak > 0) {
      // Intentional animation trigger
      const timer = setTimeout(() => {
        setAnimate(true);
        setTimeout(() => setAnimate(false), 600);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [streak]);

  const sizeClasses = {
    small: "text-2xl",
    medium: "text-4xl",
    large: "text-6xl",
  };

  const containerSizes = {
    small: "p-3",
    medium: "p-4",
    large: "p-6",
  };

  return (
    <div
      className={`${containerSizes[size]} bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl shadow-lg flex flex-col items-center justify-center transition-transform ${
        animate ? "scale-110" : "scale-100"
      }`}
    >
      <div className={`${sizeClasses[size]} font-bold text-white flex items-center gap-2`}>
        <span className={animate ? "animate-bounce" : ""}>🔥</span>
        <span>{streak}</span>
      </div>
      <div className="text-white text-sm font-medium mt-1">
        Day Streak
      </div>
    </div>
  );
}
