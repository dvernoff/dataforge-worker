import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Features that are ON by default for new projects
const DEFAULT_ENABLED_FEATURES: string[] = ['feature-cron', 'feature-backups', 'feature-analytics'];

interface FeaturesState {
  projectFeatures: Record<string, string[]>;
  isFeatureEnabled: (projectSlug: string | undefined, featureId: string) => boolean;
  setFeatureEnabled: (projectSlug: string, featureId: string, enabled: boolean) => void;
  getEnabledFeatures: (projectSlug: string | undefined) => string[];
  syncFromBackend: (projectSlug: string, featureIds: string[]) => void;
}

export const useFeaturesStore = create<FeaturesState>()(
  persist(
    (set, get) => ({
      projectFeatures: {},
      isFeatureEnabled: (projectSlug: string | undefined, featureId: string) => {
        if (!projectSlug) return false;
        const features = get().projectFeatures[projectSlug];
        if (!features) return DEFAULT_ENABLED_FEATURES.includes(featureId);
        return features.includes(featureId);
      },
      getEnabledFeatures: (projectSlug: string | undefined) => {
        if (!projectSlug) return [];
        return get().projectFeatures[projectSlug] ?? [...DEFAULT_ENABLED_FEATURES];
      },
      syncFromBackend: (projectSlug: string, featureIds: string[]) =>
        set((state) => ({
          projectFeatures: { ...state.projectFeatures, [projectSlug]: featureIds },
        })),
      setFeatureEnabled: (projectSlug: string, featureId: string, enabled: boolean) =>
        set((state) => {
          const current = state.projectFeatures[projectSlug] ?? [...DEFAULT_ENABLED_FEATURES];
          let updated: string[];
          if (enabled) {
            if (current.includes(featureId)) return state;
            updated = [...current, featureId];
          } else {
            updated = current.filter((id) => id !== featureId);
          }
          return {
            projectFeatures: { ...state.projectFeatures, [projectSlug]: updated },
          };
        }),
    }),
    {
      name: 'df-features',
    }
  )
);
