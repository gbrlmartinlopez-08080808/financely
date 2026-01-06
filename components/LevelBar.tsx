"use client";

interface LevelBarProps {
  currentXP: number;
  level: number;
  size?: "small" | "medium" | "large";
}

export default function LevelBar({ currentXP, level, size = "medium" }: LevelBarProps) {
  const xpForCurrentLevel = (level - 1) * 100;
  const xpIntoCurrentLevel = currentXP - xpForCurrentLevel;
  const progressPercentage = (xpIntoCurrentLevel / 100) * 100;
  const xpNeeded = 100 - xpIntoCurrentLevel;

  const heightClasses = {
    small: "h-2",
    medium: "h-3",
    large: "h-4",
  };

  const textSizes = {
    small: "text-xs",
    medium: "text-sm",
    large: "text-base",
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold px-3 py-1 rounded-full text-sm">
            Level {level}
          </div>
          <span className={`${textSizes[size]} text-gray-600 dark:text-gray-400`}>
            {xpIntoCurrentLevel} / 100 XP
          </span>
        </div>
        <span className={`${textSizes[size]} text-gray-500 dark:text-gray-500`}>
          {xpNeeded} XP to next level
        </span>
      </div>
      <div className={`w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden ${heightClasses[size]}`}>
        <div
          className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>
    </div>
  );
}
