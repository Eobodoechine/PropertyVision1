import { useState } from 'react';

type AnalyzeResponse = {
  ok: boolean;
  address: string;
  subject: { sqft: number | null; beds: number | null; baths: number | null; yearBuilt: number | null; subdivision: string | null };
  arv: { estimate: number | null; rangeLow: number | null; rangeHigh: number | null; method: string; confidence: string; dataPoints: number };
  compsUsed: Array<{ address: string; price: number; sqft: number; beds: number | null; baths: number | null; yearBuilt: number | null; soldDate: string | null; distance: number | null; ppsf: number; source: string | null }>;
};

export default function App() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  // Internal step tracker (not shown to end users)
  const steps = [
    'Fetch subject details',
    'Run searches',
    'Parse & filter comps',
    'Enrich comps',
    'Geocode & distance',
    'ARV calculation'
  ];
  const [stepIndex, setStepIndex] = useState(0);
  const [timerId, setTimerId] = useState<number | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setData(null);
    if (!address || address.length < 6) { setError('Enter a full address'); return; }
    setLoading(true);
    setStepIndex(0);
    if (timerId) { window.clearInterval(timerId); }
    // Lightweight pseudo-progress: advance through high-level steps while waiting
    const id = window.setInterval(() => {
      setStepIndex((i) => (i < steps.length - 1 ? i + 1 : i));
    }, 1800);
    setTimerId(id);
    try {
      const resp = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      });
      const text = await resp.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (!resp.ok || !json) {
        const msg = (json && (json.error || json.message)) || (text ? text.slice(0, 200) : `Request failed (${resp.status})`);
        throw new Error(msg || 'Request failed');
      }
      setData(json as AnalyzeResponse);
      // Snap to final step on success
      setStepIndex(steps.length - 1);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
      if (timerId) { window.clearInterval(timerId); }
      setTimerId(null);
    }
  };

  const progressPct = Math.min(100, Math.round((stepIndex / (steps.length - 1)) * 100));

  return (
    <div className="min-h-screen" style={{
      background: 'linear-gradient(135deg, #dbeafe 0%, #e0f2fe 25%, #ffffff 50%, #dcfce7 75%, #f0fdf4 100%)'
    }}>
      {/* Enhanced animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 rounded-full animate-pulse" style={{
          width: '384px',
          height: '384px',
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.2) 0%, rgba(16, 185, 129, 0.1) 100%)',
          filter: 'blur(40px)'
        }}></div>
        <div className="absolute bottom-1/4 right-1/4 rounded-full animate-pulse" style={{
          width: '384px',
          height: '384px',
          background: 'radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, rgba(139, 92, 246, 0.1) 100%)',
          filter: 'blur(40px)',
          animationDelay: '2s'
        }}></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 rounded-full animate-pulse" style={{
          width: '288px',
          height: '288px',
          background: 'radial-gradient(circle, rgba(249, 115, 22, 0.1) 0%, rgba(236, 72, 153, 0.1) 100%)',
          filter: 'blur(60px)',
          animationDelay: '4s'
        }}></div>
      </div>

      {/* Hero search (centered) */}
      {!data && (
        <main className="relative z-10 max-w-4xl mx-auto px-6">
          <div className="min-h-screen flex flex-col items-center justify-center text-center">
            <div className="mb-12 space-y-6">
              {/* Logo/Brand */}
              <div className="inline-flex items-center justify-center rounded-2xl mb-6 shadow-2xl" style={{
                width: '80px',
                height: '80px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #10b981 50%, #8b5cf6 100%)',
                boxShadow: '0 25px 50px -12px rgba(59, 130, 246, 0.4)'
              }}>
                <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24" style={{ width: '40px', height: '40px' }}>
                  <path d="M19 21V9l-7-5-7 5v12h14zm-9-9h4v7h-4v-7z"/>
                </svg>
              </div>

              {/* Main headline */}
              <div className="space-y-4">
                <h1 className="text-6xl sm:text-7xl font-bold leading-tight text-blue-600">
                  PropertyVision
                </h1>
                <p className="text-xl sm:text-2xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                  Get instant property valuations powered by AI and comprehensive market analysis
                </p>
              </div>

              {/* Feature highlights */}
              <div className="flex flex-wrap justify-center gap-4 mt-8">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg" style={{
                  background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(255, 255, 255, 0.9))',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(34, 197, 94, 0.3)'
                }}>
                  <div className="rounded-full" style={{
                    width: '12px',
                    height: '12px',
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    boxShadow: '0 2px 4px rgba(34, 197, 94, 0.3)'
                  }}></div>
                  <span className="text-sm font-semibold" style={{ color: '#15803d' }}>AI-Powered Analysis</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg" style={{
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(255, 255, 255, 0.9))',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                  <div className="rounded-full" style={{
                    width: '12px',
                    height: '12px',
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    boxShadow: '0 2px 4px rgba(59, 130, 246, 0.3)'
                  }}></div>
                  <span className="text-sm font-semibold" style={{ color: '#1d4ed8' }}>Real-time Market Data</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg" style={{
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(255, 255, 255, 0.9))',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(139, 92, 246, 0.3)'
                }}>
                  <div className="rounded-full" style={{
                    width: '12px',
                    height: '12px',
                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                    boxShadow: '0 2px 4px rgba(139, 92, 246, 0.3)'
                  }}></div>
                  <span className="text-sm font-semibold" style={{ color: '#6d28d9' }}>Comprehensive Reports</span>
                </div>
              </div>
            </div>

            {/* Enhanced search form */}
            <div className="w-full max-w-2xl">
              <form onSubmit={submit} className="relative">
                <div className="relative group">
                  <div className="absolute inset-0 rounded-2xl blur opacity-75 group-hover:opacity-100 transition duration-200" style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)'
                  }}></div>
                  <div className="relative bg-white rounded-2xl p-2 shadow-xl" style={{
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(10px)'
                  }}>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 relative">
                        <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '20px', height: '20px' }}>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 12.414a1 1 0 00-.293-.293A5.998 5.998 0 1012 4a6 6 0 005.657 8.657z" />
                        </svg>
                        <input
                          className="w-full bg-transparent pl-12 pr-4 py-4 text-lg focus:outline-none text-gray-800 placeholder:text-gray-400"
                          placeholder="Enter full address (e.g., 123 Main St, Atlanta, GA 30309)"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                        />
                      </div>
                      <button
                        disabled={loading}
                        className="text-white px-8 py-4 rounded-xl font-semibold text-lg disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 shadow-lg"
                        style={{
                          background: loading ? '#6B7280' : 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)',
                          boxShadow: loading ? 'none' : '0 8px 32px rgba(59, 130, 246, 0.3)'
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.currentTarget.style.background = 'linear-gradient(135deg, #2563eb 0%, #059669 100%)';
                            e.currentTarget.style.boxShadow = '0 12px 40px rgba(59, 130, 246, 0.4)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!loading) {
                            e.currentTarget.style.background = 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)';
                            e.currentTarget.style.boxShadow = '0 8px 32px rgba(59, 130, 246, 0.3)';
                          }
                        }}
                      >
                        {loading ? (
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            <span>Analyzing</span>
                          </div>
                        ) : (
                          'Get Valuation'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </form>

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </div>
              )}

              {/* Enhanced loading state */}
              {loading && (
                <div className="mt-8 space-y-6">
                  {/* Progress bar */}
                  <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-800">Analyzing Property</h3>
                        <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                          {progressPct}%
                        </span>
                      </div>

                      <div className="relative">
                        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-700 relative"
                            style={{ width: `${progressPct}%` }}
                          >
                            <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
                          </div>
                        </div>
                      </div>

                      <div className="text-center">
                        <p className="text-gray-600 font-medium">
                          {steps[stepIndex] || 'Processing...'}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          This usually takes 30-60 seconds
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Progress steps visualization */}
                  <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {steps.map((step, index) => (
                        <div key={index} className={`text-center p-3 rounded-xl transition-all duration-300 ${
                          index <= stepIndex
                            ? 'bg-gradient-to-r from-blue-500/20 to-emerald-500/20 border border-blue-200'
                            : 'bg-gray-50 border border-gray-200'
                        }`}>
                          <div className={`w-6 h-6 mx-auto mb-2 rounded-full flex items-center justify-center text-xs font-bold ${
                            index < stepIndex
                              ? 'bg-green-500 text-white'
                              : index === stepIndex
                                ? 'bg-blue-500 text-white animate-pulse'
                                : 'bg-gray-300 text-gray-600'
                          }`}>
                            {index < stepIndex ? '✓' : index + 1}
                          </div>
                          <p className={`text-xs font-medium ${
                            index <= stepIndex ? 'text-gray-800' : 'text-gray-500'
                          }`}>
                            {step}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {/* Results view */}
      {data && (
        <main className="relative z-10 min-h-screen">
          {/* Header with search */}
          <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-20">
            <div className="max-w-6xl mx-auto px-6 py-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-emerald-600 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 21V9l-7-5-7 5v12h14zm-9-9h4v7h-4v-7z"/>
                    </svg>
                  </div>
                  <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                    PropertyVision
                  </h1>
                </div>

                <form onSubmit={submit} className="flex-1 max-w-2xl">
                  <div className="relative group">
                    <svg className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 12.414a1 1 0 00-.293-.293A5.998 5.998 0 1012 4a6 6 0 005.657 8.657z" />
                    </svg>
                    <input
                      className="w-full bg-white border border-gray-200 rounded-xl pl-12 pr-32 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Search another address..."
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                    <button
                      disabled={loading}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-60 transition-all"
                    >
                      {loading ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          <span>Analyzing</span>
                        </div>
                      ) : (
                        'Analyze'
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-600 text-sm font-medium">{error}</p>
                </div>
              )}

              {loading && (
                <div className="mt-4">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-700" style={{ width: `${progressPct}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{progressPct}% - {steps[stepIndex] || 'Processing...'}</div>
                </div>
              )}
            </div>
          </div>

          {/* Results content */}
          <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
            {/* ARV Hero Card */}
            <div className="relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-emerald-600 rounded-3xl"></div>
              <div className="relative bg-white/95 backdrop-blur-sm rounded-3xl p-8 m-1 shadow-2xl">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                        {data.arv.confidence.toUpperCase()} CONFIDENCE
                      </div>
                      <div className="text-gray-500 text-sm">
                        {data.arv.dataPoints} comparable{data.arv.dataPoints !== 1 ? 's' : ''} analyzed
                      </div>
                    </div>

                    <div>
                      <h2 className="text-lg text-gray-600 mb-2">Estimated Property Value</h2>
                      <div className="text-5xl lg:text-6xl font-bold bg-gradient-to-r from-blue-600 to-emerald-600 bg-clip-text text-transparent">
                        {data.arv.estimate ? `$${data.arv.estimate.toLocaleString()}` : 'N/A'}
                      </div>
                      <p className="text-gray-600 mt-2">
                        {data.arv.method} • Based on recent sales data
                      </p>
                    </div>

                    {data.arv.rangeLow && data.arv.rangeHigh && (
                      <div className="bg-gray-50 rounded-xl p-4">
                        <div className="text-sm text-gray-600 mb-1">Confidence Range</div>
                        <div className="text-xl font-semibold text-gray-800">
                          ${data.arv.rangeLow.toLocaleString()} - ${data.arv.rangeHigh.toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Property details card */}
                  <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100 lg:min-w-[300px]">
                    <h3 className="font-semibold text-gray-800 mb-4">Property Details</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Address</span>
                        <span className="font-medium text-right max-w-[200px]">{data.address}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Size</span>
                        <span className="font-medium">{data.subject.sqft ? `${data.subject.sqft.toLocaleString()} sqft` : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Bedrooms</span>
                        <span className="font-medium">{data.subject.beds ?? 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Bathrooms</span>
                        <span className="font-medium">{data.subject.baths ?? 'N/A'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Year Built</span>
                        <span className="font-medium">{data.subject.yearBuilt ?? 'N/A'}</span>
                      </div>
                      {data.subject.subdivision && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subdivision</span>
                          <span className="font-medium text-right">{data.subject.subdivision}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Comparables Table */}
            <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200">
                <h3 className="text-xl font-semibold text-gray-800">Comparable Properties</h3>
                <p className="text-gray-600 text-sm mt-1">Recent sales used for valuation analysis</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-6 py-4 font-semibold text-gray-800">Property</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-800">Sale Price</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-800">Size</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-800">Price/Sqft</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-800">Bed/Bath</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-800">Year</th>
                      <th className="text-right px-6 py-4 font-semibold text-gray-800">Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.compsUsed.map((comp, i) => (
                      <tr key={i} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div>
                            <div className="font-medium text-gray-800">{comp.address}</div>
                            {comp.soldDate && (
                              <div className="text-sm text-gray-500">Sold: {comp.soldDate}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-semibold text-gray-800">${comp.price.toLocaleString()}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="text-gray-800">{comp.sqft.toLocaleString()} sqft</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-medium text-gray-800">${comp.ppsf.toFixed(2)}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="text-gray-800">{comp.beds ?? '—'} / {comp.baths ?? '—'}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="text-gray-800">{comp.yearBuilt ?? '—'}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="text-gray-800">
                            {comp.distance != null ? `${comp.distance.toFixed(2)} mi` : '—'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Analysis Summary */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 border border-blue-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-blue-900">Market Analysis</h3>
                </div>
                <p className="text-blue-800 text-sm leading-relaxed">
                  Analysis based on {data.compsUsed.length} comparable properties within the local market area using AI-powered property research.
                </p>
              </div>

              <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl p-6 border border-emerald-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-emerald-900">Confidence Level</h3>
                </div>
                <p className="text-emerald-800 text-sm leading-relaxed">
                  {data.arv.confidence.charAt(0).toUpperCase() + data.arv.confidence.slice(1)} confidence rating based on data quality, recency, and geographic proximity of comparables.
                </p>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-6 border border-purple-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-500 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-purple-900">AI-Powered</h3>
                </div>
                <p className="text-purple-800 text-sm leading-relaxed">
                  Utilizes advanced AI algorithms to analyze property features, market trends, and comparable sales data for accurate valuations.
                </p>
              </div>
            </div>
          </div>
        </main>
      )}

      <footer className="relative z-10 mt-16">
        <div className="bg-gradient-to-r from-gray-900 to-gray-800">
          <div className="max-w-6xl mx-auto px-6 py-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-emerald-600 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 21V9l-7-5-7 5v12h14zm-9-9h4v7h-4v-7z"/>
                  </svg>
                </div>
                <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                  PropertyVision
                </span>
              </div>

              <div className="text-gray-400 text-sm">
                © {new Date().getFullYear()} PropertyVision. Powered by AI-driven market analysis.
              </div>

              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  System Online
                </span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
