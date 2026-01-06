export function calculateXPForLevel(level: number): number {
  return level * 100;
}

export function calculateLevelFromXP(xp: number): number {
  return Math.floor(xp / 100) + 1;
}

export function getStreakMultiplier(streak: number): number {
  if (streak >= 30) return 3;
  if (streak >= 14) return 2;
  if (streak >= 7) return 1.5;
  return 1;
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toString();
}

export function getMotivationalMessage(streak: number, dailyGoalProgress: number, dailyGoalTarget: number): string {
  const messages = {
    goalComplete: [
      "🎉 Daily goal crushed! You're on fire!",
      "💪 Goal complete! Keep the momentum!",
      "⭐ Amazing work today! Come back tomorrow!",
      "🚀 Goal achieved! You're building great habits!",
    ],
    closeToGoal: [
      `🔥 So close! Just ${dailyGoalTarget - dailyGoalProgress} more lesson${dailyGoalTarget - dailyGoalProgress > 1 ? 's' : ''} to hit your goal!`,
      `💪 Almost there! ${dailyGoalTarget - dailyGoalProgress} lesson${dailyGoalTarget - dailyGoalProgress > 1 ? 's' : ''} until victory!`,
      `⚡ You got this! ${dailyGoalTarget - dailyGoalProgress} more to go!`,
    ],
    highStreak: [
      `🔥 ${streak} day streak! Don't break it now!`,
      `⚡ ${streak} days strong! You're unstoppable!`,
      `💎 ${streak} day streak! Keep it alive!`,
    ],
    default: [
      "💰 Ready to level up your money skills?",
      "🎯 Every lesson brings you closer to financial freedom!",
      "🚀 Let's build your financial future today!",
      "⭐ Your future self will thank you!",
      "💪 Small steps today, big results tomorrow!",
    ],
  };

  if (dailyGoalProgress >= dailyGoalTarget) {
    return messages.goalComplete[Math.floor(Math.random() * messages.goalComplete.length)];
  }

  if (dailyGoalProgress >= dailyGoalTarget - 1) {
    return messages.closeToGoal[Math.floor(Math.random() * messages.closeToGoal.length)];
  }

  if (streak >= 7) {
    return messages.highStreak[Math.floor(Math.random() * messages.highStreak.length)];
  }

  return messages.default[Math.floor(Math.random() * messages.default.length)];
}

export function getDaysUntilStreakBreak(lastActivityDate: string): number {
  const today = new Date();
  const lastActivity = new Date(lastActivityDate);
  const daysDiff = Math.floor(
    (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(0, 1 - daysDiff);
}

export function isToday(dateString: string): boolean {
  const date = new Date(dateString);
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

export function getTimeOfDay(): "morning" | "afternoon" | "evening" | "night" {
  const hour = new Date().getHours();
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

export function getGreeting(name?: string): string {
  const timeOfDay = getTimeOfDay();
  const greetings = {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    night: "Burning the midnight oil",
  };

  const greeting = greetings[timeOfDay];
  return name ? `${greeting}, ${name}!` : `${greeting}!`;
}

export function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export function celebrateWithConfetti() {
  // This would integrate with a confetti library
  // For now, it's a placeholder
  console.log("🎉 CONFETTI! 🎊");
}

export function playSound(soundName: "success" | "error" | "achievement" | "level-up") {
  // This would play actual sounds
  // For now, it's a placeholder
  console.log(`🔊 Playing sound: ${soundName}`);
}

export function vibrate(pattern: number | number[] = 50) {
  if (typeof window !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export function getRandomTip(): string {
  const tips = [
    "💡 The 24-hour rule: Wait a day before non-essential purchases!",
    "🎯 Pay yourself first—save before spending!",
    "📊 Track every dollar for 30 days to see where money really goes!",
    "⏰ Starting to invest at 16 vs 25 makes a HUGE difference!",
    "💳 Credit card golden rule: Only charge what you can pay in full!",
    "🏦 Emergency fund goal: 3-6 months of expenses!",
    "📈 Index funds offer instant diversification with low fees!",
    "🚫 If you need BNPL for non-essentials, you can't afford it!",
    "💰 Compound interest is the 8th wonder of the world!",
    "🎓 Your money mindset shapes your financial future!",
  ];
  return tips[Math.floor(Math.random() * tips.length)];
}
