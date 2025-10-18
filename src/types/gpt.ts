/**
 * Types for ChatGPT Custom GPT Integration
 */

export interface GPTAnalyzeRequest {
  address: string;
  userEmail?: string; // Optional: for tracking and notifications
}

export interface GPTAnalyzeResponse {
  jobId: string;
  status: 'queued';
  message: string;
  remainingAnalyses?: number; // How many analyses the user has left
  promotionalMessage: string; // Message about visiting enohomebuyers.com
}

export interface GPTStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  phase: string;
  phaseMessage?: string;
  estimatedTimeRemaining?: number;
  result?: PropertyAnalysisResult;
  error?: string;
  promotionalMessage: string;
}

export interface GPTUsageResponse {
  email: string;
  analysesUsed: number;
  analysesLimit: number;
  analysesRemaining: number;
  lastAnalysis?: Date;
  canAnalyze: boolean;
  promotionalMessage: string;
}

export interface PropertyAnalysisResult {
  address: string;
  subjectProperty: {
    beds?: number;
    baths?: number;
    sqft?: number;
    price?: number;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  arv?: number;
  comparables?: Array<{
    address: string;
    distance?: number;
    price?: number;
    beds?: number;
    baths?: number;
    sqft?: number;
    pricePSF?: number;
  }>;
  compsCount?: number;
  completedAt: Date;
}

export interface UsageRecord {
  email: string;
  analysesCount: number;
  limit: number;
  createdAt: Date;
  lastAnalysis: Date;
  jobIds: string[];
  source: 'chatgpt' | 'website';
  // Allow manual limit increases
  limitIncreases?: Array<{
    previousLimit: number;
    newLimit: number;
    reason?: string;
    increasedAt: Date;
    increasedBy: string; // Admin who increased it
  }>;
}

export const DEFAULT_GPT_LIMIT = 5;
export const PROMOTIONAL_MESSAGES = {
  base: 'Visit https://enohomebuyers.com to sign up for unlimited property analyses and premium features!',
  limitReached: 'You\'ve reached your free analysis limit. Sign up at https://enohomebuyers.com for unlimited access!',
  askEmail: 'Please provide your email address so we can track your usage and send you important updates.',
  errorAskEmail: 'The analysis encountered an issue. Please provide your email address so we can manually send you an updated report.',
  inaccuracyAskEmail: 'If the ARV looks incorrect, please provide your email address and we\'ll review it and send you a corrected report.',
  remainingCount: (count: number) => `You have ${count} free ${count === 1 ? 'analysis' : 'analyses'} remaining. Visit https://enohomebuyers.com to unlock unlimited access!`
};
