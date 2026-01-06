"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const { userProfile, userPreferences, updatePreference, resetProgress } = useApp();
  const router = useRouter();
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (!userProfile) {
      router.push("/onboarding");
    }
  }, [userProfile, router]);

  if (!userProfile) {
    return null;
  }

  const handleReset = () => {
    resetProgress();
    setShowResetConfirm(false);
    router.push("/onboarding");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20 pb-20 md:pb-8">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-2xl hover:scale-110 transition-transform">
              ←
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Settings</h1>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                Customize your experience
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Learning Preferences */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
            Learning Preferences
          </h2>

          {/* Learning Pace */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Learning Pace
            </label>
            <div className="space-y-2">
              {[
                { value: "slow", label: "🐢 Slow & Steady", desc: "1-2 lessons per day" },
                { value: "normal", label: "🚶 Normal Pace", desc: "3 lessons per day" },
                { value: "fast", label: "🚀 Fast Track", desc: "5+ lessons per day" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    updatePreference("learningPace", option.value as "slow" | "normal" | "fast");
                    updatePreference(
                      "dailyGoalLessons",
                      option.value === "slow" ? 2 : option.value === "normal" ? 3 : 5
                    );
                  }}
                  className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                    userPreferences.learningPace === option.value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="font-semibold text-gray-800 dark:text-gray-100">
                    {option.label}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Daily Goal */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Daily Goal: {userPreferences.dailyGoalLessons} lessons
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={userPreferences.dailyGoalLessons}
              onChange={(e) => updatePreference("dailyGoalLessons", parseInt(e.target.value))}
              className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 mt-1">
              <span>1</span>
              <span>5</span>
              <span>10</span>
            </div>
          </div>

          {/* Difficulty Level */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Difficulty Level
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "easy", label: "Easy", emoji: "😊" },
                { value: "medium", label: "Medium", emoji: "🤔" },
                { value: "hard", label: "Hard", emoji: "💪" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    updatePreference("difficultyLevel", option.value as "easy" | "medium" | "hard")
                  }
                  className={`p-4 rounded-xl border-2 transition-all ${
                    userPreferences.difficultyLevel === option.value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="text-2xl mb-1">{option.emoji}</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {option.label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Appearance</h2>

          {/* Theme */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Theme
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "light", label: "Light", emoji: "☀️" },
                { value: "dark", label: "Dark", emoji: "🌙" },
                { value: "system", label: "Auto", emoji: "💻" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    updatePreference("theme", option.value as "light" | "dark" | "system")
                  }
                  className={`p-4 rounded-xl border-2 transition-all ${
                    userPreferences.theme === option.value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="text-2xl mb-1">{option.emoji}</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {option.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Text Size */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Text Size
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    updatePreference("textSize", option.value as "small" | "medium" | "large")
                  }
                  className={`p-4 rounded-xl border-2 transition-all ${
                    userPreferences.textSize === option.value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {option.label}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Animations */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-800 dark:text-gray-100">Animations</div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Enable smooth transitions and effects
              </div>
            </div>
            <button
              onClick={() => updatePreference("animationsEnabled", !userPreferences.animationsEnabled)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                userPreferences.animationsEnabled ? "bg-purple-500" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  userPreferences.animationsEnabled ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">
            Notifications
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-gray-800 dark:text-gray-100">
                Daily Reminders
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Get reminded to complete your daily goal
              </div>
            </div>
            <button
              onClick={() =>
                updatePreference("notificationsEnabled", !userPreferences.notificationsEnabled)
              }
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                userPreferences.notificationsEnabled
                  ? "bg-purple-500"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                  userPreferences.notificationsEnabled ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Account */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 mb-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-4">Account</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-600 dark:text-gray-400">Age</div>
              <div className="font-semibold text-gray-800 dark:text-gray-100">
                {userProfile.age} years
              </div>
            </div>
            <div className="flex justify-between items-center">
              <div className="text-sm text-gray-600 dark:text-gray-400">Member Since</div>
              <div className="font-semibold text-gray-800 dark:text-gray-100">
                {new Date(userProfile.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-6 shadow-md border-2 border-red-200 dark:border-red-800">
          <h2 className="text-xl font-bold text-red-700 dark:text-red-400 mb-4">Danger Zone</h2>
          <button
            onClick={() => setShowResetConfirm(true)}
            className="w-full py-3 px-4 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors"
          >
            Reset All Progress
          </button>
          <p className="text-xs text-red-600 dark:text-red-400 mt-2 text-center">
            This will delete all your progress and restart from the beginning
          </p>
        </div>
      </main>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full shadow-xl">
            <div className="text-4xl text-center mb-4">⚠️</div>
            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-3 text-center">
              Reset All Progress?
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6 text-center text-sm">
              This will permanently delete all your lessons, XP, streaks, and achievements. This
              action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors"
              >
                Reset Everything
              </button>
            </div>
          </div>
        </div>
      )}

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
            className="flex flex-col items-center gap-1 text-gray-500 dark:text-gray-500"
          >
            <span className="text-2xl">📊</span>
            <span className="text-xs font-medium">Progress</span>
          </Link>
          <Link
            href="/settings"
            className="flex flex-col items-center gap-1 text-purple-600 dark:text-purple-400"
          >
            <span className="text-2xl">⚙️</span>
            <span className="text-xs font-medium">Settings</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
