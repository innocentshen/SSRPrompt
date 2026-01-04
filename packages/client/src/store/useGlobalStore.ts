import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Provider, Model } from '../types/database';
import { getDatabase } from '../lib/database';

interface GlobalState {
  // Data
  providers: Provider[];
  models: Model[];

  // Loading state
  isLoading: boolean;
  lastFetched: number | null;

  // Actions
  fetchProvidersAndModels: (force?: boolean) => Promise<void>;
  updateProvider: (id: string, data: Partial<Provider>) => void;
  addProvider: (provider: Provider) => void;
  removeProvider: (id: string) => void;
  addModel: (model: Model) => void;
  updateModel: (id: string, data: Partial<Model>) => void;
  removeModel: (id: string) => void;

  // Selectors
  getProviderById: (id: string) => Provider | undefined;
  getModelById: (id: string) => Model | undefined;
  getModelsByProviderId: (providerId: string) => Model[];
  getEnabledProviders: () => Provider[];
  getEnabledModels: () => Model[];
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export const useGlobalStore = create<GlobalState>()(
  devtools(
    (set, get) => ({
      providers: [],
      models: [],
      isLoading: false,
      lastFetched: null,

      fetchProvidersAndModels: async (force = false) => {
        const { lastFetched, isLoading } = get();
        const now = Date.now();

        // Skip if already loading or cache is still valid (unless forced)
        if (isLoading) return;
        if (!force && lastFetched && now - lastFetched < CACHE_DURATION) {
          return;
        }

        set({ isLoading: true });

        try {
          const db = getDatabase();
          const [providersRes, modelsRes] = await Promise.all([
            db.from('providers').select('*').order('created_at'),
            db.from('models').select('*').order('created_at'),
          ]);

          set({
            providers: providersRes.data || [],
            models: modelsRes.data || [],
            lastFetched: Date.now(),
          });
        } catch (error) {
          console.error('Failed to fetch providers and models:', error);
        } finally {
          set({ isLoading: false });
        }
      },

      updateProvider: (id, data) => {
        set(state => ({
          providers: state.providers.map(p =>
            p.id === id ? { ...p, ...data, updated_at: new Date().toISOString() } : p
          ),
        }));
      },

      addProvider: (provider) => {
        set(state => ({ providers: [...state.providers, provider] }));
      },

      removeProvider: (id) => {
        set(state => ({
          providers: state.providers.filter(p => p.id !== id),
          // Also remove associated models
          models: state.models.filter(m => m.provider_id !== id),
        }));
      },

      addModel: (model) => {
        set(state => ({ models: [...state.models, model] }));
      },

      updateModel: (id, data) => {
        set(state => ({
          models: state.models.map(m =>
            m.id === id ? { ...m, ...data } : m
          ),
        }));
      },

      removeModel: (id) => {
        set(state => ({
          models: state.models.filter(m => m.id !== id),
        }));
      },

      // Selectors
      getProviderById: (id) => get().providers.find(p => p.id === id),

      getModelById: (id) => get().models.find(m => m.id === id),

      getModelsByProviderId: (providerId) =>
        get().models.filter(m => m.provider_id === providerId),

      getEnabledProviders: () =>
        get().providers.filter(p => p.enabled),

      getEnabledModels: () => {
        const enabledProviderIds = new Set(
          get().providers.filter(p => p.enabled).map(p => p.id)
        );
        return get().models.filter(m => enabledProviderIds.has(m.provider_id));
      },
    }),
    { name: 'global-store' }
  )
);
