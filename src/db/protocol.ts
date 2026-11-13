import type { Manifest } from '../core/savefile';
import type { DayReport, UniverseInfo } from '../core/season';

export interface Status {
  appVersion: string;
  schemaVersion: number;
  universe: UniverseInfo | null;
  revision: number;
  sizeBytes: number;
  counts: Record<string, number>;
  snapshots: { name: string; reason: string; at: number; bytes: number }[];
  lastExport: string | null;
  openMs: number;
}
export interface LoadProgress {
  done: number;
  total: number;
  season: number;
  day: number;
  lastMs: number;
  record?: string;
  last?: string;
  stage?: string;
}
export interface LoadResult {
  days: number;
  cancelled: boolean;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  perSeasonAvgMs: number[];
  sizeBytes: number;
  queries: { name: string; ms: number; rows: number }[];
}
export type ImportRelation = 'sin-partida-local' | 'mas-reciente' | 'igual' | 'mas-antigua' | 'otro-universo';
export interface ImportReport {
  manifest: Manifest;
  relation: ImportRelation;
  localRevision: number | null;
  migratedFrom: number | null;
}
export interface AdvanceResult {
  reports: DayReport[];
  cancelled: boolean;
}
