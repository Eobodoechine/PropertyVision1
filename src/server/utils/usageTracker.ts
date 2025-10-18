import { db } from '../../lib/firebase';
import { doc, getDoc, setDoc, updateDoc, increment, arrayUnion } from 'firebase/firestore';
import { UsageRecord, DEFAULT_GPT_LIMIT } from '../../types/gpt';
import { jobLog } from './jobLogger';

const COLLECTION_NAME = 'gpt_usage';

/**
 * Usage Tracker for ChatGPT Custom GPT Integration
 * Tracks and enforces analysis limits for free users
 */
export class UsageTracker {
  /**
   * Check if a user can perform an analysis
   */
  async canAnalyze(email: string): Promise<{
    canAnalyze: boolean;
    analysesRemaining: number;
    record?: UsageRecord;
  }> {
    if (!email) {
      // Anonymous users can't be tracked, deny
      return {
        canAnalyze: false,
        analysesRemaining: 0
      };
    }

    const record = await this.getUsageRecord(email);

    if (!record) {
      // New user, they can analyze
      return {
        canAnalyze: true,
        analysesRemaining: DEFAULT_GPT_LIMIT
      };
    }

    const remaining = record.limit - record.analysesCount;
    return {
      canAnalyze: remaining > 0,
      analysesRemaining: Math.max(0, remaining),
      record
    };
  }

  /**
   * Get usage record for an email
   */
  async getUsageRecord(email: string): Promise<UsageRecord | null> {
    if (!email || !db) return null;

    try {
      const docRef = doc(db, COLLECTION_NAME, email.toLowerCase());
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        return null;
      }

      const data = docSnap.data();
      return {
        email: data.email,
        analysesCount: data.analysesCount || 0,
        limit: data.limit || DEFAULT_GPT_LIMIT,
        createdAt: data.createdAt?.toDate() || new Date(),
        lastAnalysis: data.lastAnalysis?.toDate() || new Date(),
        jobIds: data.jobIds || [],
        source: data.source || 'chatgpt',
        limitIncreases: data.limitIncreases || []
      };
    } catch (error) {
      console.error('Error fetching usage record:', error);
      return null;
    }
  }

  /**
   * Record a new analysis for a user
   */
  async recordAnalysis(email: string, jobId: string, source: 'chatgpt' | 'website' = 'chatgpt'): Promise<void> {
    if (!email || !db) {
      jobLog('⚠️ Cannot record analysis: email or db missing');
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const docRef = doc(db, COLLECTION_NAME, normalizedEmail);

    try {
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        // Create new usage record
        const newRecord: Omit<UsageRecord, 'limitIncreases'> = {
          email: normalizedEmail,
          analysesCount: 1,
          limit: DEFAULT_GPT_LIMIT,
          createdAt: new Date(),
          lastAnalysis: new Date(),
          jobIds: [jobId],
          source
        };

        await setDoc(docRef, {
          ...newRecord,
          limitIncreases: []
        });

        jobLog(`📊 Created new usage record for ${email}: 1/${DEFAULT_GPT_LIMIT} analyses used`);
      } else {
        // Update existing record
        await updateDoc(docRef, {
          analysesCount: increment(1),
          lastAnalysis: new Date(),
          jobIds: arrayUnion(jobId)
        });

        const updatedDoc = await getDoc(docRef);
        const data = updatedDoc.data();
        const count = data?.analysesCount || 0;
        const limit = data?.limit || DEFAULT_GPT_LIMIT;

        jobLog(`📊 Updated usage record for ${email}: ${count}/${limit} analyses used`);
      }
    } catch (error) {
      console.error('Error recording analysis:', error);
      throw new Error('Failed to record analysis usage');
    }
  }

  /**
   * Get usage stats for a user
   */
  async getUsageStats(email: string): Promise<{
    analysesUsed: number;
    analysesLimit: number;
    analysesRemaining: number;
    lastAnalysis?: Date;
    canAnalyze: boolean;
  }> {
    if (!email) {
      return {
        analysesUsed: 0,
        analysesLimit: DEFAULT_GPT_LIMIT,
        analysesRemaining: 0,
        canAnalyze: false
      };
    }

    const record = await this.getUsageRecord(email);

    if (!record) {
      return {
        analysesUsed: 0,
        analysesLimit: DEFAULT_GPT_LIMIT,
        analysesRemaining: DEFAULT_GPT_LIMIT,
        canAnalyze: true
      };
    }

    const remaining = record.limit - record.analysesCount;

    return {
      analysesUsed: record.analysesCount,
      analysesLimit: record.limit,
      analysesRemaining: Math.max(0, remaining),
      lastAnalysis: record.lastAnalysis,
      canAnalyze: remaining > 0
    };
  }

  /**
   * Manually increase a user's limit
   * (For customer support / handling failed analyses)
   */
  async increaseLimit(
    email: string,
    newLimit: number,
    reason?: string,
    increasedBy: string = 'admin'
  ): Promise<void> {
    if (!email || !db) {
      throw new Error('Email and database required');
    }

    const normalizedEmail = email.toLowerCase();
    const docRef = doc(db, COLLECTION_NAME, normalizedEmail);

    try {
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        // Create new record with increased limit
        const newRecord: Omit<UsageRecord, 'limitIncreases'> = {
          email: normalizedEmail,
          analysesCount: 0,
          limit: newLimit,
          createdAt: new Date(),
          lastAnalysis: new Date(),
          jobIds: [],
          source: 'chatgpt'
        };

        await setDoc(docRef, {
          ...newRecord,
          limitIncreases: [{
            previousLimit: DEFAULT_GPT_LIMIT,
            newLimit,
            reason,
            increasedAt: new Date(),
            increasedBy
          }]
        });

        jobLog(`✨ Created usage record with increased limit for ${email}: ${newLimit} analyses`);
      } else {
        // Update existing record
        const data = docSnap.data();
        const previousLimit = data.limit || DEFAULT_GPT_LIMIT;

        await updateDoc(docRef, {
          limit: newLimit,
          limitIncreases: arrayUnion({
            previousLimit,
            newLimit,
            reason,
            increasedAt: new Date(),
            increasedBy
          })
        });

        jobLog(`✨ Increased limit for ${email}: ${previousLimit} → ${newLimit} (reason: ${reason || 'none'})`);
      }
    } catch (error) {
      console.error('Error increasing limit:', error);
      throw new Error('Failed to increase usage limit');
    }
  }

  /**
   * Reset a user's usage count (keeps the limit)
   * Useful for monthly resets or special cases
   */
  async resetUsage(email: string): Promise<void> {
    if (!email || !db) {
      throw new Error('Email and database required');
    }

    const normalizedEmail = email.toLowerCase();
    const docRef = doc(db, COLLECTION_NAME, normalizedEmail);

    try {
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        await updateDoc(docRef, {
          analysesCount: 0,
          jobIds: []
        });

        jobLog(`🔄 Reset usage count for ${email}`);
      }
    } catch (error) {
      console.error('Error resetting usage:', error);
      throw new Error('Failed to reset usage');
    }
  }
}

// Export singleton instance
export const usageTracker = new UsageTracker();
