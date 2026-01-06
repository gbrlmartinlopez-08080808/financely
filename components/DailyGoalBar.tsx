"use client";

interface DailyGoalBarProps {
  current: number;
  target: number;
}

export default function DailyGoalBar({ current, target }: DailyGoalBarProps) {
  const progressPercentage = Math.min((current / target) * 100, 100);
  const isComplete = current >= target;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{isComplete ? "✅" : "🎯"}</span>
          <div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Daily Goal</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {isComplete
                ? "Goal complete! Amazing work! 🎉"
                : `${current} / ${target} lessons`}
            </p>
          </div>
        </div>
        {isComplete && (
          <div className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-bold">
            DONE!
          </div>
        )}
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ease-out rounded-full ${
            isComplete
              ? "bg-gradient-to-r from-green-500 to-emerald-500"
              : "bg-gradient-to-r from-blue-500 to-cyan-500"
          }`}
          style={{ width: `${progressPercentage}%` }}
        />
      </div>
      {!isComplete && current > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-2 text-center">
          {target - current} more lesson{target - current !== 1 ? "s" : ""} to reach your goal!
        </p>
      )}
    </div>
  );
}
