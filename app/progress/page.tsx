"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import AchievementBadge from "@/components/AchievementBadge";
import { achievements } from "@/data/achievements";
import { modules } from "@/data/modules";

export default function ProgressPage() {
  const { userProfile, userProgress } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!userProfile) {
      router.push("/onboarding");
    }
  }, [userProfile, router]);

  if (!userProfile) {
    return null;
  }

  const totalLessons = modules.reduce((acc, module) => acc + module.lessons.length, 0);
  const overallProgress = (userProgress.completedLessons.length / totalLessons) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20 pb-20 md:pb-8">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="text-2xl hover:scale-110 transition-transform">
                ←
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                  Your Progress
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-500">Track your journey</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700">
            <div className="text-3xl mb-2">🔥</div>
            <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {userProgress.currentStreak}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Current Streak</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700">
            <div className="text-3xl mb-2">⚡</div>
            <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {userProgress.longestStreak}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Longest Streak</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {Math.round(userProgress.averageAccuracy)}%
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Average Accuracy</div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md border border-gray-200 dark:border-gray-700">
            <div className="text-3xl mb-2">📊</div>
            <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {userProgress.level}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Current Level</div>
          </div>
        </div>

        {/* Overall Progress */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-8">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
            Overall Progress
          </h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">
                  {userProgress.completedLessons.length} / {totalLessons} lessons
                </span>
                <span className="font-bold text-gray-800 dark:text-gray-100">
                  {Math.round(overallProgress)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-500 rounded-full"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {userProgress.totalLessonsCompleted}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Lessons Done</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {userProgress.totalQuizzesCompleted}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Quizzes Passed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {userProgress.xp}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Total XP</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {Object.keys(userProgress.moduleProgress).length}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Modules Started</div>
            </div>
          </div>
        </div>

        {/* Module Progress */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-8">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
            Module Breakdown
          </h2>
          <div className="space-y-4">
            {modules.map((module) => {
              const moduleProgress = userProgress.moduleProgress[module.id];
              const percentComplete = moduleProgress?.percentComplete || 0;
              const completed = moduleProgress?.completedLessons.length || 0;
              const total = module.lessons.length;

              return (
                <div key={module.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{module.icon}</span>
                      <span className="font-semibold text-gray-800 dark:text-gray-100">
                        {module.title}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {completed} / {total} lessons
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${module.color}`}
                      style={{ width: `${percentComplete}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Achievements */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Achievements</h2>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {userProgress.unlockedBadges.length} / {achievements.length} unlocked
            </div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-6">
            {achievements.map((achievement) => (
              <AchievementBadge
                key={achievement.id}
                achievement={achievement}
                isUnlocked={userProgress.unlockedBadges.includes(achievement.id)}
                size="medium"
              />
            ))}
          </div>
        </div>

        {/* Motivational Section */}
        <div className="mt-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-6 shadow-xl">
          <div className="text-center text-white">
            <div className="text-4xl mb-3">🎊</div>
            <h3 className="text-xl font-bold mb-2">Keep Up the Great Work!</h3>
            <p className="text-white/90 text-sm max-w-md mx-auto">
              You&apos;ve completed {userProgress.completedLessons.length} lessons and earned{" "}
              {userProgress.xp} XP. You&apos;re building real financial skills!
            </p>
          </div>
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg md:hidden">
        <div className="flex items-center justify-around py-3">
          <Link
            href="/dashboard"
            className="flex flex-col items-center gap-1 text-gray-500 dark:text-gray-500"
          >
            <span className="text-2xl">🏠</span>
            <span className="text-xs font-medium">Home</span>
          </Link>
          <Link
            href="/learn"
            className="flex flex-col items-center gap-1 text-gray-500 dark:text-gray-500"
          >
            <span className="text-2xl">📚</span>
            <span className="text-xs font-medium">Learn</span>
          </Link>
          <Link
            href="/progress"
            className="flex flex-col items-center gap-1 text-purple-600 dark:text-purple-400"
          >
            <span className="text-2xl">📊</span>
            <span className="text-xs font-medium">Progress</span>
          </Link>
          <Link
            href="/settings"
            className="flex flex-col items-center gap-1 text-gray-500 dark:text-gray-500"
          >
            <span className="text-2xl">⚙️</span>
            <span className="text-xs font-medium">Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
