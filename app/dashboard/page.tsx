"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StreakCounter from "@/components/StreakCounter";
import LevelBar from "@/components/LevelBar";
import DailyGoalBar from "@/components/DailyGoalBar";
import ModuleCard from "@/components/ModuleCard";
import { modules } from "@/data/modules";
import { getMotivationalMessage, getGreeting } from "@/utils/helpers";
import { useEffect } from "react";

export default function DashboardPage() {
  const { userProfile, userProgress, userPreferences, updateStreak, updateDailyGoalProgress } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!userProfile) {
      router.push("/onboarding");
      return;
    }
    updateStreak();
    updateDailyGoalProgress();
  }, [userProfile, router, updateStreak, updateDailyGoalProgress]);

  if (!userProfile) {
    return null;
  }

  const motivationalMessage = getMotivationalMessage(
    userProgress.currentStreak,
    userProgress.dailyGoalProgress,
    userPreferences.dailyGoalLessons
  );

  const greeting = getGreeting();

  const continueLearningModule = () => {
    for (const mod of modules) {
      const moduleProgress = userProgress.moduleProgress[mod.id];
      if (moduleProgress && moduleProgress.percentComplete < 100) {
        return mod;
      }
    }
    return modules[0];
  };

  const nextModule = continueLearningModule();
  const nextLesson = nextModule.lessons.find(
    (lesson) => !userProgress.completedLessons.includes(lesson.id)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-3xl">💰</div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                  Financedly
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  Master money skills
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/progress"
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <span className="text-2xl">📊</span>
              </Link>
              <Link
                href="/settings"
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <span className="text-2xl">⚙️</span>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            {greeting}
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400">{motivationalMessage}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Streak */}
          <StreakCounter streak={userProgress.currentStreak} size="medium" />

          {/* XP Card */}
          <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl shadow-lg p-4 flex flex-col justify-center">
            <div className="text-4xl font-bold text-white">{userProgress.xp}</div>
            <div className="text-white text-sm font-medium mt-1">Total XP</div>
          </div>

          {/* Lessons Completed */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-500 rounded-2xl shadow-lg p-4 flex flex-col justify-center">
            <div className="text-4xl font-bold text-white">
              {userProgress.totalLessonsCompleted}
            </div>
            <div className="text-white text-sm font-medium mt-1">Lessons Completed</div>
          </div>

          {/* Achievements */}
          <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-2xl shadow-lg p-4 flex flex-col justify-center">
            <div className="text-4xl font-bold text-white">
              {userProgress.unlockedBadges.length}
            </div>
            <div className="text-white text-sm font-medium mt-1">Achievements</div>
          </div>
        </div>

        {/* Level Progress */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-8">
          <LevelBar currentXP={userProgress.xp} level={userProgress.level} size="large" />
        </div>

        {/* Daily Goal */}
        <div className="mb-8">
          <DailyGoalBar
            current={userProgress.dailyGoalProgress}
            target={userPreferences.dailyGoalLessons}
          />
        </div>

        {/* Continue Learning CTA */}
        {nextLesson && (
          <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-6 shadow-xl mb-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <div className="text-white/80 text-sm font-medium mb-1">CONTINUE LEARNING</div>
                <h3 className="text-2xl font-bold text-white mb-2">{nextLesson.title}</h3>
                <p className="text-white/90 text-sm">
                  {nextModule.title} • {nextLesson.estimatedMinutes} min • +{nextLesson.xpReward} XP
                </p>
              </div>
              <Link
                href={`/learn/${nextModule.id}/${nextLesson.id}`}
                className="bg-white text-purple-600 px-8 py-3 rounded-xl font-bold hover:bg-gray-50 transition-colors shadow-lg whitespace-nowrap"
              >
                Start Lesson →
              </Link>
            </div>
          </div>
        )}

        {/* Modules Grid */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              Learning Modules
            </h3>
            <Link
              href="/learn"
              className="text-purple-600 dark:text-purple-400 hover:underline text-sm font-medium"
            >
              View All →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {modules.slice(0, 6).map((module) => (
              <ModuleCard
                key={module.id}
                module={module}
                progress={userProgress.moduleProgress[module.id]}
              />
            ))}
          </div>
        </div>

        {/* Quick Tips */}
        <div className="mt-8 bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
          <div className="flex items-start gap-4">
            <span className="text-3xl">💡</span>
            <div>
              <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-2">
                Daily Financial Tip
              </h4>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                The 50/30/20 rule: Allocate 50% of income to needs, 30% to wants, and 20% to
                savings. Simple but powerful!
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg md:hidden">
        <div className="flex items-center justify-around py-3">
          <Link
            href="/dashboard"
            className="flex flex-col items-center gap-1 text-purple-600 dark:text-purple-400"
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
            className="flex flex-col items-center gap-1 text-gray-500 dark:text-gray-500"
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
