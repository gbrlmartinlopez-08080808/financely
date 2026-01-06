"use client";

import { Module, ModuleProgress } from "@/types";
import Link from "next/link";

interface ModuleCardProps {
  module: Module;
  progress?: ModuleProgress;
  isLocked?: boolean;
}

export default function ModuleCard({ module, progress, isLocked = false }: ModuleCardProps) {
  const percentComplete = progress?.percentComplete || 0;
  const completedLessons = progress?.completedLessons.length || 0;
  const totalLessons = module.lessons.length;

  return (
    <Link
      href={isLocked ? "#" : `/learn/${module.id}`}
      className={`block group ${isLocked ? "cursor-not-allowed opacity-60" : "hover:scale-105"} transition-transform duration-200`}
    >
      <div className={`${module.color} rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow`}>
        <div className="flex items-start justify-between mb-4">
          <div className="text-5xl mb-2">{module.icon}</div>
          {isLocked && (
            <div className="bg-black/20 backdrop-blur-sm px-3 py-1 rounded-full text-white text-xs font-bold">
              🔒 LOCKED
            </div>
          )}
          {percentComplete === 100 && (
            <div className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-white text-xs font-bold">
              ✓ COMPLETE
            </div>
          )}
        </div>
        
        <h3 className="text-xl font-bold text-white mb-2">{module.title}</h3>
        <p className="text-white/90 text-sm mb-4">{module.description}</p>
        
        {!isLocked && (
          <>
            <div className="mb-2">
              <div className="flex justify-between text-white text-xs mb-1">
                <span>{completedLessons} / {totalLessons} lessons</span>
                <span>{Math.round(percentComplete)}%</span>
              </div>
              <div className="w-full bg-white/20 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-white h-full transition-all duration-500 rounded-full"
                  style={{ width: `${percentComplete}%` }}
                />
              </div>
            </div>
            
            <div className="text-white/80 text-xs mt-3">
              {percentComplete === 0 && "Start learning →"}
              {percentComplete > 0 && percentComplete < 100 && "Continue →"}
              {percentComplete === 100 && "Review →"}
            </div>
          </>
        )}
        
        {isLocked && (
          <p className="text-white/80 text-xs mt-3">
            Complete previous modules to unlock
          </p>
        )}
      </div>
    </Link>
  );
}
