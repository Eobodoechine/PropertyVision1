import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  Timestamp
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { SearchHistoryEntry, SearchHistoryFilters, PropertyAnalysisResponse } from '../types/property';

const COLLECTION_NAME = 'property-searches';

export class SearchHistoryService {
  static async createSearch(userId: string, address: string): Promise<string> {
    const searchData = {
      userId,
      address,
      status: 'pending' as const,
      createdAt: Timestamp.now()
    };

    const docRef = await addDoc(collection(db, COLLECTION_NAME), searchData);
    return docRef.id;
  }

  static async updateSearchStatus(
    searchId: string,
    status: 'completed' | 'failed',
    result?: PropertyAnalysisResponse,
    error?: string
  ): Promise<void> {
    const updateData: any = {
      status,
      completedAt: Timestamp.now()
    };

    if (result) {
      updateData.result = result;
    }

    if (error) {
      updateData.error = error;
    }

    await updateDoc(doc(db, COLLECTION_NAME, searchId), updateData);
  }

  static async getUserSearchHistory(
    userId: string,
    filters?: SearchHistoryFilters
  ): Promise<SearchHistoryEntry[]> {
    let searchQuery = query(
      collection(db, COLLECTION_NAME),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    if (filters?.status && filters.status !== 'all') {
      searchQuery = query(searchQuery, where('status', '==', filters.status));
    }

    if (filters?.limit) {
      searchQuery = query(searchQuery, firestoreLimit(filters.limit));
    }

    const querySnapshot = await getDocs(searchQuery);

    return querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        address: data.address,
        status: data.status,
        createdAt: data.createdAt.toDate(),
        completedAt: data.completedAt?.toDate(),
        result: data.result,
        error: data.error
      };
    });
  }

  static async getSearchById(searchId: string): Promise<SearchHistoryEntry | null> {
    const docRef = doc(db, COLLECTION_NAME, searchId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    const data = docSnap.data();
    return {
      id: docSnap.id,
      userId: data.userId,
      address: data.address,
      status: data.status,
      createdAt: data.createdAt.toDate(),
      completedAt: data.completedAt?.toDate(),
      result: data.result,
      error: data.error
    };
  }
}