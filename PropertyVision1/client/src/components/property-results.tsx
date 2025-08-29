import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { type PropertyAnalysisResult, type ComparableProperty } from "@shared/schema";
import { useState, useEffect } from "react";
import WholesaleCalculator from "./wholesale-calculator";

interface PropertyResultsProps {
  results: PropertyAnalysisResult | null;
  error: string;
  isLoading: boolean;
  onClearError: () => void;
}

export default function PropertyResults({ results, error, isLoading, onClearError }: PropertyResultsProps) {
  const [showTwoBathComps, setShowTwoBathComps] = useState(false);

  // Reset toggle state when new results arrive
  useEffect(() => {
    if (results) {
      setShowTwoBathComps(false);
    }
  }, [results]);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="loading-section">
        <Card className="shadow-lg border border-gray-200">
          <CardContent className="p-8">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600 mr-3" />
              <p className="text-gray-600">Analyzing property...</p>
            </div>
            <div className="mt-4 space-y-2">
              <div className="bg-gray-200 rounded h-2 animate-pulse"></div>
              <div className="bg-gray-200 rounded h-2 w-3/4 animate-pulse"></div>
              <div className="bg-gray-200 rounded h-2 w-1/2 animate-pulse"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto" data-testid="error-section">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <p className="text-sm text-red-700 mt-1" data-testid="error-message">
                {error}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="bg-red-100 text-red-800 hover:bg-red-200 border-red-200"
              onClick={onClearError}
              data-testid="button-retry"
            >
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  // Determine which comparables to show
  const currentComparables = results.isDualCalculation && showTwoBathComps 
    ? results.comparablesWith2ndBath 
    : results.comparables;

  return (
    <div data-testid="results-section">
      {/* Success Alert */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6" data-testid="success-alert">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <CheckCircle className="h-5 w-5 text-green-400" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-green-800">Analysis Complete</h3>
            <p className="text-sm text-green-700 mt-1">
              {results.isDualCalculation 
                ? "Dual ARV calculation completed for 1-bathroom house with as-is and 2nd bathroom addition scenarios." 
                : `Property analysis completed successfully with ${results.arv.confidence.toLowerCase()} confidence.`
              }
            </p>
          </div>
        </div>
      </div>

      {/* ARV Results */}
      <Card className="shadow-lg border border-gray-200 mb-6">
        <CardContent className="p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4" data-testid="arv-title">
            After Repair Value (ARV)
          </h3>
          
          {results.isDualCalculation ? (
            /* Dual ARV Display for 1-Bathroom Houses */
            <div className="space-y-6">
              {/* As-Is ARV */}
              <div>
                <h4 className="text-lg font-medium text-gray-800 mb-3">📊 Current Configuration (1 Bathroom)</h4>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-blue-600 font-medium">AS-IS ARV</p>
                      <p className="text-3xl font-bold text-blue-800" data-testid="arv-estimate-asis">
                        ${results.arv.estimate}
                      </p>
                      <p className="text-sm text-blue-600">
                        ${results.arv.pricePerSqFt}/sq ft • {results.arv.confidence} confidence
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2nd Bathroom ARV */}
              <div>
                <h4 className="text-lg font-medium text-gray-800 mb-3">🚿 With 2nd Bathroom Addition</h4>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-green-600 font-medium">WITH 2ND BATHROOM ARV</p>
                      <p className="text-3xl font-bold text-green-800" data-testid="arv-estimate-2ndbath">
                        ${results.arvWith2ndBathroom?.estimate}
                      </p>
                      <p className="text-sm text-green-600">
                        ${results.arvWith2ndBathroom?.pricePerSqFt}/sq ft • {results.arvWith2ndBathroom?.confidence} confidence
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Added Value Calculation */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="text-center">
                  <p className="text-sm text-purple-600 font-medium">ADDED VALUE FROM 2ND BATHROOM</p>
                  <p className="text-2xl font-bold text-purple-800" data-testid="added-value">
                    ${(() => {
                      const asIs = parseFloat(results.arv.estimate.replace(/[$,]/g, ''));
                      const with2nd = parseFloat(results.arvWith2ndBathroom?.estimate?.replace(/[$,]/g, '') || '0');
                      return (with2nd - asIs).toLocaleString();
                    })()}
                  </p>
                  <p className="text-xs text-purple-600 mt-1">
                    Potential increase in property value
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Single ARV Display for Other Properties */
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <div className="text-center">
                <p className="text-4xl font-bold text-blue-800 mb-2" data-testid="arv-estimate">
                  ${results.arv.estimate}
                </p>
                <p className="text-lg text-blue-600 mb-4">
                  ${results.arv.pricePerSqFt} per sq ft
                </p>
                <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                  {results.arv.confidence} Confidence
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Property Details */}
      <Card className="shadow-lg border border-gray-200 mb-6">
        <CardContent className="p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4" data-testid="property-title">
            Property Details
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900" data-testid="property-beds">
                {results.property.beds || 'N/A'}
              </p>
              <p className="text-sm text-gray-600">Bedrooms</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900" data-testid="property-baths">
                {results.property.baths || 'N/A'}
              </p>
              <p className="text-sm text-gray-600">Bathrooms</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900" data-testid="property-sqft">
                {results.property.sqft ? results.property.sqft.toLocaleString() : 'N/A'}
              </p>
              <p className="text-sm text-gray-600">Sq Ft</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-900" data-testid="property-year-built">
                {results.property.yearBuilt || 'N/A'}
              </p>
              <p className="text-sm text-gray-600">Year Built</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comparables Section */}
      <Card className="shadow-lg border border-gray-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900" data-testid="comparables-title">
              Comparable Properties
            </h3>
            {results.isDualCalculation && results.comparablesWith2ndBath && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Show:</span>
                <Button
                  variant={!showTwoBathComps ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowTwoBathComps(false)}
                  data-testid="toggle-1bath-comps"
                  className="text-xs"
                >
                  1 Bath Comps
                </Button>
                <Button
                  variant={showTwoBathComps ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowTwoBathComps(true)}
                  data-testid="toggle-2bath-comps"
                  className="text-xs"
                >
                  2 Bath Comps
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-4" data-testid="comparables-grid">
            {currentComparables && currentComparables.length > 0 ? (
              currentComparables.map((comp: ComparableProperty, index: number) => {
                // Only display properties with authentic data - no fallback generation
                if (!comp.address || !comp.price || !comp.sqft) {
                  return null;
                }
                
                return (
                  <div 
                    key={comp.id || `${comp.address}-${index}`} 
                    className="border border-gray-200 rounded-lg p-4 bg-gray-50"
                    data-testid={`comparable-${index}`}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                      <div>
                        <p className="font-medium text-gray-900" data-testid={`comp-address-${index}`}>
                          {comp.address}
                        </p>
                        <p className="text-sm text-gray-600" data-testid={`comp-distance-${index}`}>
                          {comp.distance || 'Unknown distance'}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-green-600" data-testid={`comp-price-${index}`}>
                          ${Number(comp.price).toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500" data-testid={`comp-sold-date-${index}`}>
                          Sold: {comp.soldDate || 'Date unknown'}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-blue-600" data-testid={`comp-price-per-sqft-${index}`}>
                          ${Math.round(Number(comp.price) / Number(comp.sqft))}
                        </p>
                        <p className="text-xs text-gray-500">
                          per sq ft
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-gray-900" data-testid={`comp-specs-${index}`}>
                          {comp.beds || '?'} bed • {comp.baths || '?'} bath
                        </p>
                        <p className="text-xs text-gray-600" data-testid={`comp-sqft-${index}`}>
                          {Number(comp.sqft).toLocaleString()} sq ft
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }).filter(Boolean)
            ) : (
              <div className="text-center py-8 text-gray-500" data-testid="no-comparables">
                <p>No authentic comparable properties found. External API integration required.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Wholesale Calculator */}
      <WholesaleCalculator 
        arv={parseFloat(results.arv.estimate.replace(/[$,]/g, ''))} 
      />
    </div>
  );
}