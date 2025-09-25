'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Loader2, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { API_BASE_URL, cn } from '@/lib/utils';
import type { ComparableProperty, PropertyAnalysisResponse } from '@/types/property';

const DEFAULT_ADDRESS = '';

type FormState = {
  address: string;
};

async function analyzeProperty(address: string): Promise<PropertyAnalysisResponse> {
  const response = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address })
  });

  if (!response.ok) {
    const details = (await response.json().catch(() => ({}))) as { error?: string };
    const message = details.error ?? 'Analysis failed';
    throw new Error(message);
  }

  return response.json();
}

const confidenceStyles: Record<string, { label: string; className: string }> = {
  high: { label: 'High Confidence', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  medium: { label: 'Medium Confidence', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  low: { label: 'Low Confidence', className: 'bg-rose-100 text-rose-700 border-rose-200' }
};

const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatCurrency(value?: number | string | null, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return fallback;
  return formatter.format(Math.round(numeric as number));
}

function formatPpsf(price?: number | string | null, sqft?: number | string | null) {
  if (price === null || price === undefined || sqft === null || sqft === undefined) return '—';
  const priceNum = typeof price === 'string' ? Number(price) : price;
  const sqftNum = typeof sqft === 'string' ? Number(sqft) : sqft;
  if (!Number.isFinite(priceNum) || !Number.isFinite(sqftNum) || !sqftNum) return '—';
  return `$${Math.round(priceNum / sqftNum).toLocaleString()}`;
}

function formatDistance(distance?: number | string | null) {
  if (distance === null || distance === undefined) return '—';
  const value = typeof distance === 'string' ? Number(distance) : distance;
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} miles`;
}

function formatSoldDate(date?: string) {
  if (!date) return '—';
  return date.slice(0, 10);
}

export default function HomePage() {
  const [formState, setFormState] = React.useState<FormState>({ address: DEFAULT_ADDRESS });
  const [progress, setProgress] = React.useState(0);

  const mutation = useMutation<PropertyAnalysisResponse, Error, string>({
    mutationFn: analyzeProperty,
    onSettled: () => setProgress(0)
  });

  React.useEffect(() => {
    if (!mutation.isPending) return;

    setProgress(20);
    const interval = window.setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return 35;
        return prev + 8;
      });
    }, 450);

    return () => window.clearInterval(interval);
  }, [mutation.isPending]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = formState.address.trim();
    if (!address) return;
    mutation.mutate(address);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormState(prev => ({ ...prev, address: event.target.value }));
  };

  const result = mutation.data;
  const loading = mutation.isPending;
  const error = mutation.isError ? (mutation.error as Error) : null;

  return (
    <main className="w-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-16 pt-10 md:px-6">
        <Header />

        <Card className="border-0 bg-white/90 shadow-lg shadow-slate-200/40 backdrop-blur">
          <CardHeader className="gap-3">
            <CardTitle className="text-2xl font-semibold">Analyze any property in seconds</CardTitle>
            <CardDescription className="text-slate-500">
              Enter a full street address to generate ARV, property insights, and comparable sales.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleSubmit}>
              <Input
                aria-label="Street address"
                placeholder="Enter address"
                value={formState.address}
                onChange={handleChange}
                disabled={loading}
              />
              <Button type="submit" className="md:w-44" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Analyze Property
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {loading ? <LoadingState progress={progress} /> : null}
        {error ? <ErrorState message={error.message} onRetry={() => mutation.reset()} /> : null}

        {result ? (
          <section className="space-y-8">
            <AnalysisSummary data={result} />
            <PropertyDetails data={result} />
            <ComparableList comps={result.compsUsed} />
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white/90 px-6 py-5 shadow-sm shadow-slate-200/40 backdrop-blur md:flex-row md:items-center">
      <div>
        <p className="text-sm font-medium text-slate-500">PropertyAnalyzer</p>
        <h1 className="text-2xl font-semibold text-slate-900">ARV &amp; Comps Dashboard</h1>
      </div>
    </header>
  );
}

function LoadingState({ progress }: { progress: number }) {
  return (
    <Card className="border-0 bg-white/90 shadow shadow-slate-200/40">
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Loader2 className="h-5 w-5 animate-spin" /> Analyzing property…
        </CardTitle>
        <CardDescription className="text-slate-500">
          We’re pulling property details, recent sales, and calculating ARV.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" title="Analysis failed">
      <p className="text-sm text-rose-600">{message || 'Something went wrong while analyzing the property.'}</p>
      <div className="mt-3 flex gap-3">
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href="mailto:support@propertyvision.app">Contact support</a>
        </Button>
      </div>
    </Alert>
  );
}

function AnalysisSummary({ data }: { data: PropertyAnalysisResponse }) {
  const subjectSqft = data.subject.sqft ?? undefined;
  const confidence = data.arv?.confidence && confidenceStyles[data.arv.confidence];

  const perSqft = data.arv?.estimate && subjectSqft ? `$${Math.round(data.arv.estimate / subjectSqft)}/sq ft` : '—';

  return (
    <Card className="border-0 bg-white shadow-lg shadow-slate-200/40">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle className="text-3xl font-semibold text-slate-900">ARV Summary</CardTitle>
          <CardDescription className="text-base text-slate-500">
            {data.subject.address}
          </CardDescription>
        </div>
        {confidence ? <Badge className={cn('px-3 py-1 text-sm font-medium', confidence.className)}>{confidence.label}</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-slate-500">After Repair Value</p>
        <p className="text-4xl font-semibold text-slate-900">
          {data.arv ? formatCurrency(data.arv.estimate) : 'ARV unavailable'}
        </p>
        <p className="text-sm text-slate-500">{perSqft}</p>
      </CardContent>
    </Card>
  );
}

function PropertyDetails({ data }: { data: PropertyAnalysisResponse }) {
  const details = [
    { label: 'Bedrooms', value: data.subject.beds ?? '—' },
    { label: 'Bathrooms', value: data.subject.baths ?? '—' },
    { label: 'Square Feet', value: data.subject.sqft?.toLocaleString() ?? '—' },
    { label: 'Year Built', value: data.subject.yearBuilt ?? '—' }
  ];

  return (
    <Card className="border-0 bg-white shadow-sm shadow-slate-200/50">
      <CardContent className="grid gap-4 md:grid-cols-4">
        {details.map(detail => (
          <div key={detail.label} className="rounded-2xl bg-slate-100/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{detail.label}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{detail.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ComparableList({ comps }: { comps: ComparableProperty[] }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900">Comparable Properties</h2>
        <Badge variant="secondary">{comps.length} comps</Badge>
      </div>

      {comps.length === 0 ? (
        <Alert title="No comparable sales found">
          No comparable sales found within the filters.
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {comps.map(comp => {
            const price = typeof comp.price === 'string' ? Number(comp.price) : comp.price;
            const sqft = typeof comp.sqft === 'string' ? Number(comp.sqft) : comp.sqft;
            const beds = typeof comp.beds === 'string' ? Number(comp.beds) : comp.beds;
            const baths = typeof comp.baths === 'string' ? Number(comp.baths) : comp.baths;

            return (
              <Card key={`${comp.address}-${comp.soldDate ?? ''}`} className="border-0 bg-white shadow-sm shadow-slate-200/50">
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                    <a
                      href={comp.url ?? '#'}
                      target={comp.url ? '_blank' : undefined}
                      rel={comp.url ? 'noreferrer' : undefined}
                      className="text-base font-semibold text-slate-900 hover:underline"
                    >
                      {comp.address}
                    </a>
                    <p className="flex items-center gap-1 text-sm text-slate-500">
                      <MapPin className="h-4 w-4" /> {formatDistance(comp.distance)}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-emerald-600">{formatCurrency(price)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span className="font-semibold text-blue-600">{formatPpsf(price, sqft)}</span>
                  <span>• {beds ?? '—'} bd</span>
                  <span>• {baths ?? '—'} ba</span>
                  <span>• {sqft?.toLocaleString() ?? '—'} sqft</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Sold: {formatSoldDate(comp.soldDate)}</span>
                  {comp.source ? (
                    <a
                      href={comp.url ?? '#'}
                      target={comp.url ? '_blank' : undefined}
                      rel={comp.url ? 'noreferrer' : undefined}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
                    >
                      {comp.source}
                      {comp.url ? <ExternalLink className="h-3 w-3" /> : null}
                    </a>
                  ) : null}
                </div>
              </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

