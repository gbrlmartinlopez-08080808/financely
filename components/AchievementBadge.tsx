"use client";

import { Achievement } from "@/types";

interface AchievementBadgeProps {
  achievement: Achievement;
  isUnlocked: boolean;
  size?: "small" | "medium" | "large";
}

export default function AchievementBadge({
  achievement,
  isUnlocked,
  size = "medium",
}: AchievementBadgeProps) {
  const sizeClasses = {
    small: "w-16 h-16 text-2xl",
    medium: "w-20 h-20 text-3xl",
    large: "w-24 h-24 text-4xl",
  };

  const textSizes = {
    small: "text-xs",
    medium: "text-sm",
    large: "text-base",
  };

  return (
    <div className="flex flex-col items-center">
      <div
        className={`${sizeClasses[size]} rounded-full flex items-center justify-center mb-2 transition-all duration-300 ${
          isUnlocked
            ? "bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg hover:scale-110"
            : "bg-gray-300 dark:bg-gray-700 grayscale opacity-50"
        }`}
      >
        <span className={isUnlocked ? "" : "opacity-40"}>{achievement.icon}</span>
      </div>
      <h4
        className={`${textSizes[size]} font-semibold text-center max-w-[100px] ${
          isUnlocked ? "text-gray-800 dark:text-gray-100" : "text-gray-400 dark:text-gray-600"
        }`}
      >
        {achievement.title}
      </h4>
      <p className="text-xs text-gray-500 dark:text-gray-500 text-center max-w-[100px] mt-1">
        {isUnlocked ? `+${achievement.xpReward} XP` : achievement.requirement}
      </p>
    </div>
  );
}
