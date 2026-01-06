"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
  UserProfile,
  UserPreferences,
  UserProgress,
  ModuleProgress,
} from "@/types";
import { modules } from "@/data/modules";
import { achievements } from "@/data/achievements";

interface AppContextType {
  // User Profile
  userProfile: UserProfile | null;
  setUserProfile: (profile: UserProfile) => void;
  
  // User Preferences
  userPreferences: UserPreferences;
  setUserPreferences: (preferences: UserPreferences) => void;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => void;
  
  // User Progress
  userProgress: UserProgress;
  setUserProgress: (progress: UserProgress) => void;
  completeLesson: (lessonId: string, moduleId: string, xpEarned: number) => void;
  completeQuiz: (lessonId: string, accuracy: number) => void;
  updateDailyGoalProgress: () => void;
  updateStreak: () => void;
  unlockBadge: (badgeId: string) => void;
  
  // App State
  isOnboarding: boolean;
  setIsOnboarding: (value: boolean) => void;
  currentModule: string | null;
  setCurrentModule: (moduleId: string | null) => void;
  currentLesson: string | null;
  setCurrentLesson: (lessonId: string | null) => void;
  
  // Utilities
  getLevel: () => number;
  getXPForNextLevel: () => number;
  getProgressPercentage: () => number;
  canAccessLesson: (lessonId: string, moduleId: string) => boolean;
  getModuleProgress: (moduleId: string) => ModuleProgress | undefined;
  resetProgress: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEYS = {
  USER_PROFILE: "financedly_user_profile",
  USER_PREFERENCES: "financedly_user_preferences",
  USER_PROGRESS: "financedly_user_progress",
  ONBOARDING: "financedly_onboarding",
};

// Default values
const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "system",
  learningPace: "normal",
  difficultyLevel: "medium",
  topicPreferences: [],
  dailyGoalLessons: 3,
  notificationsEnabled: true,
  textSize: "medium",
  animationsEnabled: true,
};

const DEFAULT_PROGRESS: UserProgress = {
  xp: 0,
  level: 1,
  currentStreak: 0,
  longestStreak: 0,
  lastActivityDate: new Date().toISOString(),
  completedLessons: [],
  unlockedBadges: [],
  moduleProgress: {},
  dailyGoalProgress: 0,
  totalLessonsCompleted: 0,
  totalQuizzesCompleted: 0,
  averageAccuracy: 0,
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [userProfile, setUserProfileState] = useState<UserProfile | null>(null);
  const [userPreferences, setUserPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [userProgress, setUserProgressState] = useState<UserProgress>(DEFAULT_PROGRESS);
  const [isOnboarding, setIsOnboardingState] = useState(true);
  const [currentModule, setCurrentModule] = useState<string | null>(null);
  const [currentLesson, setCurrentLesson] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount - this is initialization, not a side effect
  useEffect(() => {
    if (typeof window !== "undefined" && !isLoaded) {
      try {
        const savedProfile = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
        const savedPreferences = localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES);
        const savedProgress = localStorage.getItem(STORAGE_KEYS.USER_PROGRESS);
        const savedOnboarding = localStorage.getItem(STORAGE_KEYS.ONBOARDING);

        if (savedProfile) {
          setUserProfileState(JSON.parse(savedProfile));
        }
        if (savedPreferences) {
          setUserPreferencesState(JSON.parse(savedPreferences));
        }
        if (savedProgress) {
          setUserProgressState(JSON.parse(savedProgress));
        }
        if (savedOnboarding !== null) {
          setIsOnboardingState(savedOnboarding === "true");
        }
      } catch (error) {
        console.error("Error loading from localStorage:", error);
      }
      setIsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to localStorage whenever data changes
  useEffect(() => {
    if (isLoaded && typeof window !== "undefined") {
      if (userProfile) {
        localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(userProfile));
      }
      localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(userPreferences));
      localStorage.setItem(STORAGE_KEYS.USER_PROGRESS, JSON.stringify(userProgress));
      localStorage.setItem(STORAGE_KEYS.ONBOARDING, String(isOnboarding));
    }
  }, [userProfile, userPreferences, userProgress, isOnboarding, isLoaded]);

  const setUserProfile = (profile: UserProfile) => {
    setUserProfileState(profile);
  };

  const setUserPreferences = (preferences: UserPreferences) => {
    setUserPreferencesState(preferences);
  };

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    setUserPreferencesState((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const setUserProgress = (progress: UserProgress) => {
    setUserProgressState(progress);
  };

  const setIsOnboarding = (value: boolean) => {
    setIsOnboardingState(value);
  };

  const getLevel = () => {
    // 100 XP per level
    return Math.floor(userProgress.xp / 100) + 1;
  };

  const getXPForNextLevel = () => {
    const currentLevel = getLevel();
    return currentLevel * 100;
  };

  const getProgressPercentage = () => {
    const currentLevel = getLevel();
    const xpForCurrentLevel = (currentLevel - 1) * 100;
    const xpIntoCurrentLevel = userProgress.xp - xpForCurrentLevel;
    return (xpIntoCurrentLevel / 100) * 100;
  };

  const canAccessLesson = (lessonId: string, moduleId: string) => {
    const targetModule = modules.find((m) => m.id === moduleId);
    if (!targetModule) return false;

    const lesson = targetModule.lessons.find((l) => l.id === lessonId);
    if (!lesson) return false;

    // First lesson is always accessible
    if (lesson.order === 1) return true;

    // Check if previous lesson is completed
    const previousLesson = targetModule.lessons.find((l) => l.order === lesson.order - 1);
    if (!previousLesson) return false;

    return userProgress.completedLessons.includes(previousLesson.id);
  };

  const getModuleProgress = (moduleId: string): ModuleProgress | undefined => {
    return userProgress.moduleProgress[moduleId];
  };

  const completeLesson = (lessonId: string, moduleId: string, xpEarned: number) => {
    setUserProgressState((prev) => {
      // Don't re-award XP for already completed lessons
      const isAlreadyCompleted = prev.completedLessons.includes(lessonId);
      const newXP = isAlreadyCompleted ? prev.xp : prev.xp + xpEarned;
      const newCompletedLessons = isAlreadyCompleted
        ? prev.completedLessons
        : [...prev.completedLessons, lessonId];

      // Update module progress
      const currentModule = modules.find((m) => m.id === moduleId);
      if (!currentModule) return prev;

      const moduleCompletedLessons = newCompletedLessons.filter((id) =>
        currentModule.lessons.some((l) => l.id === id)
      );

      const percentComplete = (moduleCompletedLessons.length / currentModule.lessons.length) * 100;

      const newModuleProgress = {
        ...prev.moduleProgress,
        [moduleId]: {
          moduleId,
          completedLessons: moduleCompletedLessons,
          currentLessonIndex: moduleCompletedLessons.length,
          percentComplete,
          unlockedAt: prev.moduleProgress[moduleId]?.unlockedAt || new Date().toISOString(),
        },
      };

      // Check for achievements
      const newUnlockedBadges = [...prev.unlockedBadges];
      
      // First lesson achievement
      if (newCompletedLessons.length === 1 && !newUnlockedBadges.includes("first-lesson")) {
        newUnlockedBadges.push("first-lesson");
      }

      // Module complete achievement
      if (percentComplete === 100 && !newUnlockedBadges.includes("module-complete")) {
        newUnlockedBadges.push("module-complete");
      }

      // XP milestones
      if (newXP >= 100 && !newUnlockedBadges.includes("xp-100")) {
        newUnlockedBadges.push("xp-100");
      }
      if (newXP >= 500 && !newUnlockedBadges.includes("xp-500")) {
        newUnlockedBadges.push("xp-500");
      }
      if (newXP >= 1000 && !newUnlockedBadges.includes("xp-1000")) {
        newUnlockedBadges.push("xp-1000");
      }

      return {
        ...prev,
        xp: newXP,
        level: Math.floor(newXP / 100) + 1,
        completedLessons: newCompletedLessons,
        totalLessonsCompleted: isAlreadyCompleted
          ? prev.totalLessonsCompleted
          : prev.totalLessonsCompleted + 1,
        moduleProgress: newModuleProgress,
        dailyGoalProgress: prev.dailyGoalProgress + 1,
        unlockedBadges: newUnlockedBadges,
        lastActivityDate: new Date().toISOString(),
      };
    });
  };

  const completeQuiz = (lessonId: string, accuracy: number) => {
    setUserProgressState((prev) => ({
      ...prev,
      totalQuizzesCompleted: prev.totalQuizzesCompleted + 1,
      averageAccuracy:
        (prev.averageAccuracy * prev.totalQuizzesCompleted + accuracy) /
        (prev.totalQuizzesCompleted + 1),
    }));
  };

  const updateDailyGoalProgress = () => {
    const today = new Date().toISOString().split("T")[0];
    const lastActivity = new Date(userProgress.lastActivityDate).toISOString().split("T")[0];

    if (today !== lastActivity) {
      setUserProgressState((prev) => ({
        ...prev,
        dailyGoalProgress: 0,
        lastActivityDate: new Date().toISOString(),
      }));
    }
  };

  const updateStreak = () => {
    const today = new Date();
    const lastActivity = new Date(userProgress.lastActivityDate);
    const daysDiff = Math.floor(
      (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
    );

    setUserProgressState((prev) => {
      let newStreak = prev.currentStreak;
      const newUnlockedBadges = [...prev.unlockedBadges];

      if (daysDiff === 1) {
        // Continuing streak
        newStreak = prev.currentStreak + 1;
      } else if (daysDiff > 1) {
        // Streak broken
        newStreak = 1;
      }

      // Check streak achievements
      if (newStreak >= 7 && !newUnlockedBadges.includes("streak-7")) {
        newUnlockedBadges.push("streak-7");
      }
      if (newStreak >= 30 && !newUnlockedBadges.includes("streak-30")) {
        newUnlockedBadges.push("streak-30");
      }

      return {
        ...prev,
        currentStreak: newStreak,
        longestStreak: Math.max(newStreak, prev.longestStreak),
        unlockedBadges: newUnlockedBadges,
        lastActivityDate: new Date().toISOString(),
      };
    });
  };

  const unlockBadge = (badgeId: string) => {
    setUserProgressState((prev) => {
      if (prev.unlockedBadges.includes(badgeId)) return prev;

      const badge = achievements.find((a) => a.id === badgeId);
      const xpReward = badge?.xpReward || 0;

      return {
        ...prev,
        unlockedBadges: [...prev.unlockedBadges, badgeId],
        xp: prev.xp + xpReward,
        level: Math.floor((prev.xp + xpReward) / 100) + 1,
      };
    });
  };

  const resetProgress = () => {
    setUserProgressState(DEFAULT_PROGRESS);
    localStorage.removeItem(STORAGE_KEYS.USER_PROGRESS);
  };

  const value: AppContextType = {
    userProfile,
    setUserProfile,
    userPreferences,
    setUserPreferences,
    updatePreference,
    userProgress,
    setUserProgress,
    completeLesson,
    completeQuiz,
    updateDailyGoalProgress,
    updateStreak,
    unlockBadge,
    isOnboarding,
    setIsOnboarding,
    currentModule,
    setCurrentModule,
    currentLesson,
    setCurrentLesson,
    getLevel,
    getXPForNextLevel,
    getProgressPercentage,
    canAccessLesson,
    getModuleProgress,
    resetProgress,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
