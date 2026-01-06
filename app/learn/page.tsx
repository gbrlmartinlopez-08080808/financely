"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ModuleCard from "@/components/ModuleCard";
import { modules } from "@/data/modules";
import { useEffect } from "react";

export default function LearnPage() {
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
  const completedLessons = userProgress.completedLessons.length;
  const overallProgress = (completedLessons / totalLessons) * 100;

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
                  Learning Modules
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-500">
                  Choose what to learn next
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Overall Progress */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                Overall Progress
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {completedLessons} of {totalLessons} lessons completed
              </p>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
              {Math.round(overallProgress)}%
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-500 rounded-full"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>

        {/* Modules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {modules.map((mod) => (
          <ModuleCard
            key={mod.id}
            module={mod}
            progress={userProgress.moduleProgress[mod.id]}
          />
        ))}
        </div>

        {/* Motivational Message */}
        <div className="mt-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-6 shadow-xl">
          <div className="text-center text-white">
            <div className="text-4xl mb-3">🚀</div>
            <h3 className="text-xl font-bold mb-2">Keep Going!</h3>
            <p className="text-white/90 text-sm max-w-md mx-auto">
              Every lesson brings you closer to financial confidence. You&apos;re building skills that
              will benefit you for life!
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
            className="flex flex-col items-center gap-1 text-purple-600 dark:text-purple-400"
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
