"use client";

import { useApp } from "@/context/AppContext";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { modules } from "@/data/modules";
import { useEffect } from "react";

export default function ModulePage() {
  const { userProfile, userProgress, canAccessLesson } = useApp();
  const router = useRouter();
  const params = useParams();
  const moduleId = params.moduleId as string;

  useEffect(() => {
    if (!userProfile) {
      router.push("/onboarding");
    }
  }, [userProfile, router]);

  const currentModule = modules.find((m) => m.id === moduleId);

  if (!currentModule || !userProfile) {
    return null;
  }

  const moduleProgress = userProgress.moduleProgress[moduleId];
  const completedLessons = moduleProgress?.completedLessons.length || 0;
  const totalLessons = currentModule.lessons.length;
  const percentComplete = (completedLessons / totalLessons) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20 pb-8">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/learn" className="text-2xl hover:scale-110 transition-transform">
              ←
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {currentModule.icon} {currentModule.title}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">{currentModule.description}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress Overview */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Your Progress</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {completedLessons} of {totalLessons} lessons completed
              </p>
            </div>
            <div className="text-3xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
              {Math.round(percentComplete)}%
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-500 rounded-full"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
        </div>

        {/* Lessons List */}
        <div className="space-y-4">
          {currentModule.lessons.map((lesson, index) => {
            const isCompleted = userProgress.completedLessons.includes(lesson.id);
            const isAccessible = canAccessLesson(lesson.id, moduleId);
            const isLocked = !isAccessible && !isCompleted;

            return (
              <Link
                key={lesson.id}
                href={isLocked ? "#" : `/learn/${moduleId}/${lesson.id}`}
                className={`block ${
                  isLocked ? "cursor-not-allowed opacity-60" : "hover:scale-102"
                } transition-all`}
              >
                <div
                  className={`bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border-2 transition-all ${
                    isCompleted
                      ? "border-green-500"
                      : isAccessible
                      ? "border-purple-300 dark:border-purple-700 hover:border-purple-500"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                        isCompleted
                          ? "bg-green-500 text-white"
                          : isAccessible
                          ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                          : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                      }`}
                    >
                      {isCompleted ? "✓" : isLocked ? "🔒" : index + 1}
                    </div>

                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                          {lesson.title}
                        </h3>
                        {!isLocked && (
                          <div className="flex items-center gap-3 text-sm">
                            <span className="text-gray-500 dark:text-gray-500">
                              {lesson.estimatedMinutes} min
                            </span>
                            <span className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-1 rounded-full font-medium">
                              +{lesson.xpReward} XP
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isCompleted && (
                          <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full font-medium">
                            Completed
                          </span>
                        )}
                        {isAccessible && !isCompleted && (
                          <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-1 rounded-full font-medium">
                            Available
                          </span>
                        )}
                        {isLocked && (
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-1 rounded-full font-medium">
                            Complete previous lesson to unlock
                          </span>
                        )}
                      </div>

                      {lesson.quiz.length > 0 && !isLocked && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                          📝 {lesson.quiz.length} quiz questions
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
