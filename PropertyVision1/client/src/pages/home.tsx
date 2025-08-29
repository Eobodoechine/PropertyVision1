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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
      </main>

      <Footer />
    </div>
  );
}
