"use client";

import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import { UserProfile, UserPreferences } from "@/types";

export default function OnboardingPage() {
  const { setUserProfile, setUserPreferences, setIsOnboarding } = useApp();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    age: 16,
    learningPace: "normal" as "slow" | "normal" | "fast",
    difficultyLevel: "medium" as "easy" | "medium" | "hard",
    topicPreferences: [] as string[],
    dailyGoalLessons: 3,
    theme: "system" as "light" | "dark" | "system",
  });

  const topics = [
    { id: "fundamentals", label: "💰 Money Basics", emoji: "💰" },
    { id: "banking", label: "🏦 Banking", emoji: "🏦" },
    { id: "spending", label: "🛒 Smart Spending", emoji: "🛒" },
    { id: "earning", label: "💼 Earning Money", emoji: "💼" },
    { id: "investing", label: "📈 Investing", emoji: "📈" },
    { id: "credit", label: "💳 Credit & Debt", emoji: "💳" },
    { id: "realworld", label: "🌍 Real-World Skills", emoji: "🌍" },
  ];

  const handleTopicToggle = (topicId: string) => {
    setFormData((prev) => ({
      ...prev,
      topicPreferences: prev.topicPreferences.includes(topicId)
        ? prev.topicPreferences.filter((id) => id !== topicId)
        : [...prev.topicPreferences, topicId],
    }));
  };

  const handleComplete = () => {
    const profile: UserProfile = {
      id: `user_${Date.now()}`,
      age: formData.age,
      onboardingCompleted: true,
      createdAt: new Date().toISOString(),
    };

    const preferences: UserPreferences = {
      theme: formData.theme,
      learningPace: formData.learningPace,
      difficultyLevel: formData.difficultyLevel,
      topicPreferences: formData.topicPreferences,
      dailyGoalLessons: formData.dailyGoalLessons,
      notificationsEnabled: true,
      textSize: "medium",
      animationsEnabled: true,
    };

    setUserProfile(profile);
    setUserPreferences(preferences);
    setIsOnboarding(false);
    router.push("/dashboard");
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="animate-fade-in">
            <div className="text-6xl mb-6 text-center animate-bounce">👋</div>
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4 text-center">
              Welcome to Financedly!
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-8 max-w-md mx-auto">
              Master money skills through fun, bite-sized lessons. Learn at your own pace and
              build financial confidence!
            </p>
            <div className="flex flex-col gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎮</span>
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Gamified Learning</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Earn XP, level up, and unlock achievements
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔥</span>
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Build Streaks</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Stay consistent and watch your progress soar
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📚</span>
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-100">Real Skills</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Learn practical money skills for real life
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="animate-fade-in">
            <div className="text-6xl mb-6 text-center">🎂</div>
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4 text-center">
              How old are you?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-8">
              We&apos;ll tailor content to your age group
            </p>
            <div className="max-w-sm mx-auto">
              <input
                type="range"
                min="15"
                max="17"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) })}
                className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="text-center mt-4">
                <div className="text-6xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
                  {formData.age}
                </div>
                <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">years old</p>
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="animate-fade-in">
            <div className="text-6xl mb-6 text-center">⚡</div>
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4 text-center">
              Choose your pace
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-8">
              How quickly do you want to learn?
            </p>
            <div className="space-y-3 max-w-md mx-auto">
              {[
                { value: "slow", label: "🐢 Slow & Steady", desc: "1-2 lessons per day" },
                { value: "normal", label: "🚶 Normal Pace", desc: "3 lessons per day" },
                { value: "fast", label: "🚀 Fast Track", desc: "5+ lessons per day" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      learningPace: option.value as "slow" | "normal" | "fast",
                      dailyGoalLessons: option.value === "slow" ? 2 : option.value === "normal" ? 3 : 5,
                    })
                  }
                  className={`w-full p-4 rounded-xl border-2 transition-all ${
                    formData.learningPace === option.value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="text-left">
                    <div className="font-semibold text-gray-800 dark:text-gray-100">
                      {option.label}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{option.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 4:
        return (
          <div className="animate-fade-in">
            <div className="text-6xl mb-6 text-center">📚</div>
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4 text-center">
              What interests you most?
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-8">
              Select any topics you want to prioritize (optional)
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  onClick={() => handleTopicToggle(topic.id)}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    formData.topicPreferences.includes(topic.id)
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 scale-95"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="text-3xl mb-2">{topic.emoji}</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {topic.label.split(" ").slice(1).join(" ")}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-gray-500 dark:text-gray-500 mt-6">
              Don&apos;t worry, you&apos;ll learn all topics eventually!
            </p>
          </div>
        );

      case 5:
        return (
          <div className="animate-fade-in">
            <div className="text-6xl mb-6 text-center">🎨</div>
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4 text-center">
              Choose your theme
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-8">
              Pick the look that suits you best
            </p>
            <div className="space-y-3 max-w-md mx-auto">
              {[
                { value: "light", label: "☀️ Light Mode", desc: "Bright and energetic" },
                { value: "dark", label: "🌙 Dark Mode", desc: "Easy on the eyes" },
                { value: "system", label: "💻 Auto", desc: "Match your device" },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      theme: option.value as "light" | "dark" | "system",
                    })
                  }
                  className={`w-full p-4 rounded-xl border-2 transition-all ${
                    formData.theme === option.value
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="text-left">
                    <div className="font-semibold text-gray-800 dark:text-gray-100">
                      {option.label}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">{option.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        );

      case 6:
        return (
          <div className="animate-fade-in">
            <div className="text-6xl mb-6 text-center animate-pulse-scale">🚀</div>
            <h2 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-4 text-center">
              You&apos;re all set!
            </h2>
            <p className="text-gray-600 dark:text-gray-400 text-center mb-8 max-w-md mx-auto">
              Ready to start your financial literacy journey? Let&apos;s make money skills fun!
            </p>
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-6 rounded-xl max-w-md mx-auto">
              <h3 className="font-bold text-gray-800 dark:text-gray-100 mb-4">Your Settings:</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Age:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100">
                    {formData.age} years
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Pace:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100 capitalize">
                    {formData.learningPace}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Daily Goal:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100">
                    {formData.dailyGoalLessons} lessons
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Theme:</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100 capitalize">
                    {formData.theme}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="text-2xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
              Financedly
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-500">
              Step {step} of 6
            </div>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${(step / 6) * 100}%` }}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 mb-6">
          {renderStep()}
        </div>

        <div className="flex gap-4">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-3 px-6 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={() => {
              if (step < 6) {
                setStep(step + 1);
              } else {
                handleComplete();
              }
            }}
            className="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg hover:shadow-xl"
          >
            {step < 6 ? "Continue" : "Let's Start! 🚀"}
          </button>
        </div>
      </div>
    </div>
  );
}
