import { KIND_WEIGHTS, type BatonTouchKind } from '../domain/baton-touch';

export type RankFactor = {
  code: string;
  label: string;
  weight: number;
  value: number;
  contribution: number;
};

export type RankExplanation = {
  algorithmVersion: 'touch-rank-v1';
  score: number;
  factors: RankFactor[];
  summary: string;
  calculatedAt: string;
};

export type RankInputs = {
  kind: BatonTouchKind | string;
  impact?: number | null;
  urgency?: number | null;
  effort?: number | null;
  depsSatisfied?: boolean;
  openedAt: string;
  escalatedAt?: string | null;
  workModeBias?: number | null;
  manualRankOverride?: number | null;
  now?: Date;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function ageHours(openedAt: string, now: Date): number {
  const opened = Date.parse(openedAt);
  if (Number.isNaN(opened)) return 0;
  return Math.max(0, (now.getTime() - opened) / 3_600_000);
}

/**
 * touch-rank-v1 (design.md §4.1). Deterministic; no LLM.
 */
export function computeTouchRank(input: RankInputs): RankExplanation {
  const now = input.now || new Date();
  const kind = String(input.kind) as BatonTouchKind;
  const kindWeight = KIND_WEIGHTS[kind] ?? 4;
  const impact = Number(input.impact ?? 5);
  const urgency = Number(input.urgency ?? 5);
  const effort = Number(input.effort ?? 5);
  const readiness = input.depsSatisfied === false ? 0 : 10;
  const age = Math.min(ageHours(input.openedAt, now), 72) / 8;
  const escalation = input.escalatedAt ? 15 : 0;
  const workMode = clamp(Number(input.workModeBias ?? 0), -2, 2);
  const manual = Number(input.manualRankOverride ?? 0);

  const factors: RankFactor[] = [
    {
      code: 'kind',
      label: 'Kind weight',
      weight: 3,
      value: kindWeight,
      contribution: kindWeight * 3,
    },
    {
      code: 'impact',
      label: 'Task impact',
      weight: 4,
      value: impact,
      contribution: impact * 4,
    },
    {
      code: 'urgency',
      label: 'Task urgency',
      weight: 3,
      value: urgency,
      contribution: urgency * 3,
    },
    {
      code: 'readiness',
      label: 'Dependency readiness',
      weight: 2,
      value: readiness,
      contribution: readiness * 2,
    },
    {
      code: 'age',
      label: 'Age hours (capped)',
      weight: 1,
      value: age,
      contribution: age,
    },
    {
      code: 'escalation',
      label: 'Escalation boost',
      weight: 1,
      value: escalation,
      contribution: escalation,
    },
    {
      code: 'effort',
      label: 'Effort penalty',
      weight: -1,
      value: effort,
      contribution: -effort,
    },
    {
      code: 'work_mode',
      label: 'Work mode bias',
      weight: 1,
      value: workMode,
      contribution: workMode,
    },
    {
      code: 'manual_override',
      label: 'Manual rank override',
      weight: 1,
      value: manual,
      contribution: manual,
    },
  ];

  const raw = factors.reduce((sum, f) => sum + f.contribution, 0);
  const score = clamp(raw, 0, 200);
  return {
    algorithmVersion: 'touch-rank-v1',
    score,
    factors,
    summary: `touch-rank-v1 score ${score.toFixed(1)} (kind=${kindWeight}, impact=${impact}, urgency=${urgency})`,
    calculatedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}
