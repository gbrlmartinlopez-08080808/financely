"use client";

import { useApp } from "@/context/AppContext";
import { useRouter, useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { modules } from "@/data/modules";
import Link from "next/link";
import ConfettiAnimation from "@/components/ConfettiAnimation";

export default function LessonPage() {
  const { userProfile, userProgress, completeLesson, completeQuiz } = useApp();
  const router = useRouter();
  const params = useParams();
  const [currentContentIndex, setCurrentContentIndex] = useState(0);
  const [isQuizMode, setIsQuizMode] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [quizResults, setQuizResults] = useState<boolean[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);

  const moduleId = params.moduleId as string;
  const lessonId = params.lessonId as string;

  useEffect(() => {
    if (!userProfile) {
      router.push("/onboarding");
    }
  }, [userProfile, router]);

  const currentModule = modules.find((m) => m.id === moduleId);
  const lesson = currentModule?.lessons.find((l) => l.id === lessonId);

  if (!currentModule || !lesson || !userProfile) {
    return null;
  }

  const isLessonCompleted = userProgress.completedLessons.includes(lessonId);

  const handleNext = () => {
    if (currentContentIndex < lesson.content.length - 1) {
      setCurrentContentIndex(currentContentIndex + 1);
    } else {
      setIsQuizMode(true);
    }
  };

  const handlePrevious = () => {
    if (currentContentIndex > 0) {
      setCurrentContentIndex(currentContentIndex - 1);
    }
  };

  const handleQuizAnswer = () => {
    if (selectedAnswer === null) return;

    const isCorrect = selectedAnswer === lesson.quiz[currentQuestionIndex].correctAnswer;
    setQuizResults([...quizResults, isCorrect]);
    setShowExplanation(true);
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < lesson.quiz.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedAnswer(null);
      setShowExplanation(false);
    } else {
      handleQuizComplete();
    }
  };

  const handleQuizComplete = () => {
    const correctAnswers = quizResults.filter((r) => r).length;
    const accuracy = (correctAnswers / lesson.quiz.length) * 100;
    
    completeQuiz(lessonId, accuracy);
    completeLesson(lessonId, moduleId, lesson.xpReward);
    
    setShowConfetti(true);
    setTimeout(() => {
      const nextLesson = currentModule.lessons.find((l) => l.order === lesson.order + 1);
      if (nextLesson) {
        router.push(`/learn/${moduleId}/${nextLesson.id}`);
      } else {
        router.push("/dashboard");
      }
    }, 3000);
  };

  const renderContent = () => {
    if (isQuizMode) {
      const question = lesson.quiz[currentQuestionIndex];
      const isCorrect = selectedAnswer === question.correctAnswer;

      return (
        <div className="animate-fade-in">
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="bg-purple-100 dark:bg-purple-900/30 px-4 py-2 rounded-full">
                <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                  Question {currentQuestionIndex + 1} of {lesson.quiz.length}
                </span>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-500">
                +{question.xpReward} XP
              </div>
            </div>

            <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">
              {question.question}
            </h3>

            <div className="space-y-3">
              {question.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => !showExplanation && setSelectedAnswer(index)}
                  disabled={showExplanation}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                    showExplanation
                      ? index === question.correctAnswer
                        ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                        : index === selectedAnswer
                        ? "border-red-500 bg-red-50 dark:bg-red-900/20"
                        : "border-gray-200 dark:border-gray-700 opacity-50"
                      : selectedAnswer === index
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20 scale-95"
                      : "border-gray-200 dark:border-gray-700 hover:border-purple-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                        showExplanation
                          ? index === question.correctAnswer
                            ? "bg-green-500 text-white"
                            : index === selectedAnswer
                            ? "bg-red-500 text-white"
                            : "bg-gray-200 dark:bg-gray-700 text-gray-500"
                          : selectedAnswer === index
                          ? "bg-purple-500 text-white"
                          : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {String.fromCharCode(65 + index)}
                    </div>
                    <span className="text-gray-800 dark:text-gray-100">{option}</span>
                    {showExplanation && index === question.correctAnswer && (
                      <span className="ml-auto text-2xl">✓</span>
                    )}
                    {showExplanation && index === selectedAnswer && index !== question.correctAnswer && (
                      <span className="ml-auto text-2xl">✗</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {showExplanation && (
              <div
                className={`mt-6 p-4 rounded-xl animate-slide-up ${
                  isCorrect
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-3xl">{isCorrect ? "🎉" : "💡"}</span>
                  <div>
                    <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-2">
                      {isCorrect ? "Correct!" : "Not quite!"}
                    </h4>
                    <p className="text-gray-700 dark:text-gray-300 text-sm">
                      {question.explanation}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {showExplanation && (
            <button
              onClick={handleNextQuestion}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg"
            >
              {currentQuestionIndex < lesson.quiz.length - 1 ? "Next Question →" : "Complete Lesson 🎉"}
            </button>
          )}

          {!showExplanation && (
            <button
              onClick={handleQuizAnswer}
              disabled={selectedAnswer === null}
              className={`w-full py-4 rounded-xl font-bold transition-all shadow-lg ${
                selectedAnswer === null
                  ? "bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600"
              }`}
            >
              Check Answer
            </button>
          )}
        </div>
      );
    }

    const content = lesson.content[currentContentIndex];
    
    return (
      <div className="animate-fade-in">
        <div className="mb-8">
          {content.type === "text" && (
            <p
              className={`text-lg text-gray-700 dark:text-gray-300 leading-relaxed ${
                content.emphasis ? "font-semibold" : ""
              }`}
            >
              {content.content}
            </p>
          )}

          {content.type === "example" && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 p-4 rounded-r-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">📝</span>
                <pre className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">
                  {content.content}
                </pre>
              </div>
            </div>
          )}

          {content.type === "tip" && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-500 p-4 rounded-r-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">💡</span>
                <p className="text-gray-700 dark:text-gray-300 font-medium">{content.content}</p>
              </div>
            </div>
          )}

          {content.type === "scenario" && (
            <div className="bg-purple-50 dark:bg-purple-900/20 border-l-4 border-purple-500 p-4 rounded-r-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🎭</span>
                <p className="text-gray-700 dark:text-gray-300">{content.content}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          {currentContentIndex > 0 && (
            <button
              onClick={handlePrevious}
              className="flex-1 py-4 rounded-xl border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              ← Previous
            </button>
          )}
          <button
            onClick={handleNext}
            className="flex-1 py-4 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg"
          >
            {currentContentIndex < lesson.content.length - 1 ? "Next →" : "Start Quiz 🎯"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900/20 dark:to-pink-900/20">
      <ConfettiAnimation show={showConfetti} />

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Link
              href={`/learn/${moduleId}`}
              className="text-2xl hover:scale-110 transition-transform"
            >
              ←
            </Link>
            <div className="flex-1">
              <div className="text-sm text-gray-500 dark:text-gray-500">{currentModule.title}</div>
              <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
                {lesson.title}
              </h1>
            </div>
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {lesson.estimatedMinutes} min
            </div>
          </div>

          {/* Progress Bar */}
          {!isQuizMode && (
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-full transition-all duration-300 rounded-full"
                style={{
                  width: `${((currentContentIndex + 1) / (lesson.content.length + 1)) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-200 dark:border-gray-700">
          {renderContent()}
        </div>

        {isLessonCompleted && !isQuizMode && (
          <div className="mt-4 text-center">
            <div className="inline-flex items-center gap-2 bg-green-50 dark:bg-green-900/20 px-4 py-2 rounded-full border border-green-200 dark:border-green-800">
              <span>✓</span>
              <span className="text-sm font-medium text-green-700 dark:text-green-300">
                Lesson completed
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
