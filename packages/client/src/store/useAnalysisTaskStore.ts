import { create } from 'zustand';
import type { EvaluationAnalysisScope } from '../types';

export type AnalysisTaskStatus = 'running' | 'completed' | 'failed' | 'aborted';
export type AnalysisTaskPhase = 'idle' | 'generating' | 'saving';

export interface AnalysisTask {
  id: string;
  evaluationId: string;
  scope: EvaluationAnalysisScope;
  runLabel: string;
  runIds: string[];
  status: AnalysisTaskStatus;
  phase: AnalysisTaskPhase;
  reportId: string | null;
  errorMessage: string | null;
  startedAt: string;
  updatedAt: string;
}

interface AnalysisTaskState {
  task: AnalysisTask | null;
  collapsed: boolean;
  startTask: (payload: { evaluationId: string; scope: EvaluationAnalysisScope; runLabel: string; runIds: string[] }) => void;
  setPhase: (phase: AnalysisTaskPhase) => void;
  completeTask: (payload: { reportId?: string | null }) => void;
  failTask: (errorMessage?: string | null) => void;
  abortTask: () => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  clearTask: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useAnalysisTaskStore = create<AnalysisTaskState>((set) => ({
  task: null,
  collapsed: false,

  startTask: ({ evaluationId, scope, runLabel, runIds }) => {
    const timestamp = nowIso();
    set({
      task: {
        id: `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        evaluationId,
        scope,
        runLabel,
        runIds: [...runIds],
        status: 'running',
        phase: 'generating',
        reportId: null,
        errorMessage: null,
        startedAt: timestamp,
        updatedAt: timestamp,
      },
      collapsed: false,
    });
  },

  setPhase: (phase) => {
    set((state) => {
      if (!state.task || state.task.status !== 'running') return state;
      return {
        task: {
          ...state.task,
          phase,
          updatedAt: nowIso(),
        },
      };
    });
  },

  completeTask: ({ reportId }) => {
    set((state) => {
      if (!state.task) return state;
      return {
        task: {
          ...state.task,
          status: 'completed',
          phase: 'idle',
          reportId: reportId ?? state.task.reportId,
          errorMessage: null,
          updatedAt: nowIso(),
        },
        collapsed: true,
      };
    });
  },

  failTask: (errorMessage) => {
    set((state) => {
      if (!state.task) return state;
      return {
        task: {
          ...state.task,
          status: 'failed',
          phase: 'idle',
          errorMessage: errorMessage ?? null,
          updatedAt: nowIso(),
        },
        collapsed: true,
      };
    });
  },

  abortTask: () => {
    set((state) => {
      if (!state.task) return state;
      return {
        task: {
          ...state.task,
          status: 'aborted',
          phase: 'idle',
          errorMessage: null,
          updatedAt: nowIso(),
        },
        collapsed: true,
      };
    });
  },

  setCollapsed: (collapsed) => {
    set({ collapsed });
  },

  toggleCollapsed: () => {
    set((state) => ({ collapsed: !state.collapsed }));
  },

  clearTask: () => {
    set({ task: null, collapsed: false });
  },
}));
