import { useState } from "react";
import Header from "@/components/header";
import Footer from "@/components/footer";
import PropertySearchForm from "@/components/property-search-form";
import PropertyResults from "@/components/property-results";
import { type PropertyAnalysisResult } from "@shared/schema";

export default function Home() {
  const [results, setResults] = useState<PropertyAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const handleAnalysisComplete = (data: PropertyAnalysisResult) => {
    setResults(data);
    setError("");
  };

  const handleAnalysisError = (errorMessage: string) => {
    setError(errorMessage);
    setResults(null);
  };

  const handleAnalysisStart = () => {
    setIsLoading(true);
    setError("");
    setResults(null);
  };

  const handleAnalysisEnd = () => {
    setIsLoading(false);
  };

  const showHero = !results && !isLoading && !error;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-sky-50 via-blue-50/30 to-emerald-50">
      <Header />

      <main className="flex-1">
        {showHero ? (
          <div className="max-w-3xl mx-auto px-4">
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
              <div className="mb-8">
                <div className="text-4xl sm:text-5xl font-semibold tracking-tight text-slate-800">PropertyVision</div>
                <div className="text-slate-500 mt-2">Find property value with one simple search</div>
              </div>
              <PropertySearchForm
                onAnalysisStart={handleAnalysisStart}
                onAnalysisComplete={handleAnalysisComplete}
                onAnalysisError={handleAnalysisError}
                onAnalysisEnd={handleAnalysisEnd}
                isLoading={isLoading}
              />
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Compact search bar again for subsequent searches */}
            <PropertySearchForm
              onAnalysisStart={handleAnalysisStart}
              onAnalysisComplete={handleAnalysisComplete}
              onAnalysisError={handleAnalysisError}
              onAnalysisEnd={handleAnalysisEnd}
              isLoading={isLoading}
            />
            <PropertyResults
              results={results}
              error={error}
              isLoading={isLoading}
              onClearError={() => setError("")}
            />
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
