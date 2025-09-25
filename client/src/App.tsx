import { useState } from 'react';
import { Loader2, Home, MapPin, Calendar, TrendingUp, Bed, Bath, Square, Clock } from 'lucide-react';

type PropertyDetails = {
  sqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
};

type Comparable = {
  address: string;
  price: number;
  sqft: number;
  beds: number;
  baths: number;
  soldDate: string;
  distance: number;
  ppsf: number;
};

type AnalysisResult = {
  arv: {
    estimate: number;
    confidence: 'high' | 'medium' | 'low';
    ppsf: number;
  };
  property: PropertyDetails;
  comparables: Comparable[];
};

const Badge = ({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'high' | 'medium' | 'low' }) => {
  const variants = {
    default: 'bg-gray-100 text-gray-800',
    high: 'bg-blue-100 text-blue-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800'
  };

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
};

const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>
    {children}
  </div>
);

const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`}></div>
);

export default function App() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    setLoading(true);
    setError('');
    setData(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: address.trim() })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Analysis failed');
      }

      // Transform backend data to match our interface
      setData({
        arv: {
          estimate: result.arv?.estimate || 0,
          confidence: result.arv?.confidence || 'low',
          ppsf: result.arv?.estimate && result.subject?.sqft
            ? Math.round(result.arv.estimate / result.subject.sqft)
            : 0
        },
        property: {
          sqft: result.subject?.sqft || 0,
          beds: result.subject?.beds || 0,
          baths: result.subject?.baths || 0,
          yearBuilt: result.subject?.yearBuilt || 0
        },
        comparables: result.compsUsed?.map((comp: any) => ({
          address: comp.address,
          price: comp.price,
          sqft: comp.sqft,
          beds: comp.beds || 0,
          baths: comp.baths || 0,
          soldDate: comp.soldDate || '',
          distance: comp.distance || 0,
          ppsf: comp.ppsf || Math.round(comp.price / comp.sqft)
        })) || []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(amount);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'Unknown';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <Home className="w-6 h-6 text-blue-600" />
              <span className="text-xl font-semibold text-gray-900">PropertyAnalyzer</span>
              <span className="text-sm text-gray-500 hidden sm:inline">ARV & Comps</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Panel - Google-style centered */}
        <div className="text-center py-16 mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">PropertyAnalyzer</h1>
          <p className="text-xl text-gray-600 mb-12">Get instant ARV estimates and comparable sales analysis</p>

          <form onSubmit={handleAnalyze} className="max-w-2xl mx-auto">
            <div className="flex items-center bg-white rounded-full shadow-lg border border-gray-200 hover:shadow-xl transition-shadow duration-200 overflow-hidden">
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter address"
                className="flex-1 px-6 py-4 text-lg border-none outline-none focus:ring-0"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !address.trim()}
                className="px-8 py-4 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors duration-200"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <TrendingUp className="w-5 h-5" />
                )}
                <span className="hidden sm:inline">{loading ? 'Analyzing...' : 'Analyze Property'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Progress Area */}
        {loading && (
          <div className="mb-8">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span className="text-blue-900 font-medium">Analyzing property...</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
              </div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-8">
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-5 h-5 bg-red-500 rounded-full flex-shrink-0"></div>
                <span className="text-red-900 font-medium">Analysis Error</span>
              </div>
              <p className="text-red-700 mb-4">{error}</p>
              <button
                onClick={() => setError('')}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Loading Skeletons */}
        {loading && (
          <>
            {/* ARV Card Skeleton */}
            <Card className="p-6 mb-8">
              <Skeleton className="h-8 w-48 mb-2" />
              <Skeleton className="h-6 w-32 mb-4" />
              <Skeleton className="h-6 w-24" />
            </Card>

            {/* Property Details Skeleton */}
            <Card className="p-6 mb-8">
              <Skeleton className="h-6 w-32 mb-4" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="text-center">
                    <Skeleton className="h-8 w-16 mx-auto mb-2" />
                    <Skeleton className="h-4 w-20 mx-auto" />
                  </div>
                ))}
              </div>
            </Card>

            {/* Comparables Skeleton */}
            <Card className="p-6">
              <Skeleton className="h-6 w-40 mb-4" />
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 border border-gray-100 rounded-xl">
                    <Skeleton className="h-5 w-64 mb-2" />
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* Results */}
        {data && !loading && (
          <>
            {/* ARV Card */}
            <Card className="p-6 mb-8">
              <div className="text-center">
                <div className="text-4xl font-bold text-gray-900 mb-2">
                  {formatCurrency(data.arv.estimate)}
                </div>
                <div className="text-lg text-gray-600 mb-4">
                  {formatCurrency(data.arv.ppsf)} per sq ft
                </div>
                <Badge variant={data.arv.confidence}>
                  {data.arv.confidence.charAt(0).toUpperCase() + data.arv.confidence.slice(1)} Confidence
                </Badge>
              </div>
            </Card>

            {/* Property Details */}
            <Card className="p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Property Details</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-xl mx-auto mb-2">
                    <Bed className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{data.property.beds}</div>
                  <div className="text-sm text-gray-600">Bedrooms</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-xl mx-auto mb-2">
                    <Bath className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{data.property.baths}</div>
                  <div className="text-sm text-gray-600">Bathrooms</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-xl mx-auto mb-2">
                    <Square className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{data.property.sqft.toLocaleString()}</div>
                  <div className="text-sm text-gray-600">Sq Ft</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-xl mx-auto mb-2">
                    <Clock className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-gray-900">{data.property.yearBuilt}</div>
                  <div className="text-sm text-gray-600">Year Built</div>
                </div>
              </div>
            </Card>

            {/* Comparable Properties */}
            <Card className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Comparable Properties</h2>
              {data.comparables.length === 0 ? (
                <div className="text-center py-8 text-gray-600">
                  No comparable sales found within the filters.
                </div>
              ) : (
                <div className="space-y-4">
                  {data.comparables.map((comp, index) => (
                    <div key={index} className="p-4 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <button className="text-blue-600 hover:text-blue-800 font-medium text-left">
                            {comp.address}
                          </button>
                          <div className="flex items-center text-sm text-gray-600 mt-1">
                            <MapPin className="w-4 h-4 mr-1" />
                            {comp.distance.toFixed(2)} miles away
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-green-600">
                            {formatCurrency(comp.price)}
                          </div>
                          <div className="text-sm text-blue-600 font-medium">
                            {formatCurrency(comp.ppsf)}/sq ft
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-between items-center text-sm text-gray-600">
                        <div className="flex items-center space-x-4">
                          <span>{comp.beds} bed • {comp.baths} bath</span>
                          <span>{comp.sqft.toLocaleString()} sq ft</span>
                        </div>
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 mr-1" />
                          Sold: {formatDate(comp.soldDate)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}