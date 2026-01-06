"use client";

import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const { isOnboarding, userProfile } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (userProfile && !isOnboarding) {
      router.push("/dashboard");
    } else if (!userProfile || isOnboarding) {
      router.push("/onboarding");
    }
  }, [userProfile, isOnboarding, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500">
      <div className="text-center">
        <div className="text-6xl mb-4 animate-bounce">💰</div>
        <h1 className="text-4xl font-bold text-white mb-2">Financedly</h1>
        <p className="text-white/80">Loading your financial journey...</p>
      </div>
    </div>
  );
}
