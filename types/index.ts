export type LearningPace = "slow" | "normal" | "fast";
export type ThemePreference = "light" | "dark" | "system";
export type DifficultyLevel = "easy" | "medium" | "hard";

export interface UserProfile {
  id: string;
  age: number;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface UserPreferences {
  theme: ThemePreference;
  learningPace: LearningPace;
  difficultyLevel: DifficultyLevel;
  topicPreferences: string[];
  dailyGoalLessons: number;
  notificationsEnabled: boolean;
  dailyReminderTime?: string;
  textSize: "small" | "medium" | "large";
  animationsEnabled: boolean;
}

export interface UserProgress {
  xp: number;
  level: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string;
  completedLessons: string[];
  unlockedBadges: string[];
  moduleProgress: Record<string, ModuleProgress>;
  dailyGoalProgress: number;
  totalLessonsCompleted: number;
  totalQuizzesCompleted: number;
  averageAccuracy: number;
}

export interface ModuleProgress {
  moduleId: string;
  completedLessons: string[];
  currentLessonIndex: number;
  percentComplete: number;
  unlockedAt: string;
}

export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  xpReward: number;
}

export interface Lesson {
  id: string;
  title: string;
  moduleId: string;
  order: number;
  content: LessonContent[];
  quiz: Question[];
  xpReward: number;
  estimatedMinutes: number;
  unlockRequirement?: string;
}

export interface LessonContent {
  type: "text" | "example" | "tip" | "scenario" | "image";
  content: string;
  emphasis?: boolean;
}

export interface Module {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  order: number;
  lessons: Lesson[];
  unlockRequirement?: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  requirement: string;
  xpReward: number;
  unlockedAt?: string;
}

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  completed: boolean;
  date: string;
}

export interface Statistics {
  totalXP: number;
  currentStreak: number;
  longestStreak: number;
  totalLessons: number;
  totalQuizzes: number;
  averageAccuracy: number;
  daysActive: number;
  currentLevel: number;
  activeDays: string[];
}
