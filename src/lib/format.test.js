import { describe, it, expect } from "vitest";

import {
  decisionWinner,
  formatSideTruePositives,
  formatTpExpectedFound,
  formatTruePositives,
  replicaAwareProblemTotals,
  sideDetectionTotals,
} from "./format.js";

const ev = (tp) => ({ evaluated: true, true_positives: tp });

// A project passing on multiple replicas must be scored BEST-OF, never summed:
// three replicas each finding 1 TP is a 1-TP project, not a 3-TP project.
const proj0 = {
  project_key: "code4rena_virtuals-protocol_2025_08",
  true_positives: 1,
  total_expected: 6,
  total_found: 2,
  replicas: [
    { replica_index: 1, evaluated: true, true_positives: 1, total_expected: 6, total_found: 3 },
    { replica_index: 2, evaluated: true, true_positives: 1, total_expected: 6, total_found: 3 },
    { replica_index: 3, evaluated: true, true_positives: 1, total_expected: 6, total_found: 3 },
  ],
};

describe("replicaAwareProblemTotals (best-of, not summed)", () => {
  it("uses the scorer's best-of project value, not the replica sum", () => {
    const totals = replicaAwareProblemTotals(proj0, 3);
    expect(totals.truePositives).toBe(1); // best-of, NOT 1+1+1=3
    expect(totals.totalExpected).toBe(6); // per-project, NOT 6+6+6=18
    expect(totals.totalFound).toBe(2); // scorer best replica, NOT 3+3+3=9
  });

  it("the whole king detail sums to the headline (5), not the replica sum (11)", () => {
    const projects = [
      proj0, // tp 1
      { true_positives: 0, total_expected: 1, total_found: 3, replicas: [{ evaluated: true, true_positives: 0 }] },
      { true_positives: 1, total_expected: 4, total_found: 6, replicas: [{ evaluated: true, true_positives: 0 }, { evaluated: true, true_positives: 1 }, { evaluated: true, true_positives: 0 }] },
      { true_positives: 0, total_expected: 2, total_found: 2, replicas: [] },
      { true_positives: 1, total_expected: 2, total_found: 3, replicas: [{ evaluated: true, true_positives: 0 }, { evaluated: true, true_positives: 1 }, { evaluated: true, true_positives: 0 }] },
      { true_positives: 2, total_expected: 7, total_found: 3, replicas: [{ evaluated: true, true_positives: 2 }, { evaluated: true, true_positives: 2 }, { evaluated: true, true_positives: 2 }] },
      { true_positives: 0, total_expected: 3, total_found: 1, replicas: [] },
    ];
    const sum = projects.reduce((n, p) => n + replicaAwareProblemTotals(p, 3).truePositives, 0);
    expect(sum).toBe(5);
  });

  it("falls back to the best replica (max, not sum) when the project summary is absent", () => {
    const midProgress = {
      total_expected: 6,
      replicas: [
        { replica_index: 1, evaluated: true, true_positives: 2, total_expected: 6, total_found: 5 },
        { replica_index: 2, evaluated: true, true_positives: 1, total_expected: 6, total_found: 4 },
      ],
    };
    expect(replicaAwareProblemTotals(midProgress, 2).truePositives).toBe(2); // best-of, NOT 3
  });

  it("formatTpExpectedFound renders best-of tp/exp/found", () => {
    expect(formatTpExpectedFound(proj0, 3)).toBe("1/6/2");
  });
});

// A project the scorer would emit: best-of true positives, per-project expected,
// and one evaluated replica row per run.
const proj = (key, exp, tps) => ({
  project_key: key,
  total_expected: exp,
  true_positives: Math.max(0, ...tps),
  replicas: tps.map((tp, i) => ({
    replica_index: i + 1,
    evaluated: true,
    true_positives: tp,
    total_expected: exp,
  })),
});

describe("sideDetectionTotals (king and candidate aggregated identically)", () => {
  const king = {
    true_positives: 5,
    total_expected: 25,
    projects: [
      proj("virtuals", 6, [1, 1, 1]),
      proj("fenix", 1, [0, 0, 0]),
      proj("axion", 4, [0, 1, 0]),
      proj("pump", 2, [0, 0, 0]),
      proj("generic", 2, [0, 1, 0]),
      proj("perennial", 7, [2, 2, 2]),
      proj("secondswap", 3, [0, 0, 0]),
    ],
  };
  // The candidate header is the inflated raw per-replica SUM (8 / 72) the engine wrote
  // mid-scoring; its real best-of score is 4 / 25.
  const candidate = {
    true_positives: 8,
    total_expected: 72,
    projects: [
      proj("virtuals", 6, [0, 0, 0]),
      proj("fenix", 1, [0, 0, 0]),
      proj("axion", 4, [1, 1, 2]),
      proj("pump", 2, [0, 0, 0]),
      proj("generic", 2, [0, 1, 1]),
      proj("perennial", 7, [0, 0, 0]),
      proj("secondswap", 3, [1, 1, 0]),
    ],
  };

  it("scores the king best-of = 5 / 25", () => {
    const t = sideDetectionTotals(king, 3);
    expect(t.truePositives).toBe(5);
    expect(t.totalExpected).toBe(25);
    expect(formatSideTruePositives(king, 3)).toBe("5 / 25");
  });

  it("ignores the candidate's inflated 8 / 72 header and scores it best-of = 4 / 25", () => {
    const t = sideDetectionTotals(candidate, 3);
    expect(t.truePositives).toBe(4); // NOT 8
    expect(t.totalExpected).toBe(25); // NOT 72
    expect(formatSideTruePositives(candidate, 3)).toBe("4 / 25");
  });

  it("collapses per-replica duplicate project entries to one best-of score", () => {
    const flattened = {
      true_positives: 4, // per-replica sum
      projects: [
        { project_key: "axion", total_expected: 4, true_positives: 1, replicas: [ev(1)] },
        { project_key: "axion", total_expected: 4, true_positives: 1, replicas: [ev(1)] },
        { project_key: "axion", total_expected: 4, true_positives: 2, replicas: [ev(2)] },
      ],
    };
    expect(sideDetectionTotals(flattened, 3).truePositives).toBe(2); // best-of, once
  });

  it("falls back to the side header when there are no projects", () => {
    expect(sideDetectionTotals({ true_positives: 16, total_expected: 84 }).truePositives).toBe(16);
    expect(formatSideTruePositives({ true_positives: 16, total_expected: 84 })).toBe("16 / 84");
  });
});

describe("formatTruePositives (count with denominator)", () => {
  it("shows tp against its expected so samples are comparable", () => {
    expect(formatTruePositives({ true_positives: 5, total_expected: 25 })).toBe("5 / 25");
    expect(formatTruePositives({ true_positives: 16, total_expected: 84 })).toBe("16 / 84");
  });
  it("handles missing data", () => {
    expect(formatTruePositives({})).toBe("—");
    expect(formatTruePositives({ true_positives: 3 })).toBe("3");
  });
});

describe("decisionWinner (one-sided promotion margin)", () => {
  const higher = (candidate, king) => ({ candidateValue: candidate, kingValue: king, higherIsBetter: true });
  const lower = (candidate, king) => ({ candidateValue: candidate, kingValue: king, higherIsBetter: false });

  it("with margin 0 behaves like the strict comparison", () => {
    expect(decisionWinner(higher(0.2, 0.1))).toBe("candidate"); // ahead
    expect(decisionWinner(higher(0.1, 0.2))).toBe("king"); // behind
    expect(decisionWinner(higher(0.1, 0.1))).toBe("tie"); // exact tie
    // "fewer is better" flips direction: fewer invalid runs wins.
    expect(decisionWinner(lower(0, 3))).toBe("candidate");
    expect(decisionWinner(lower(3, 0))).toBe("king");
  });

  it("treats an ahead-but-within-margin lead as a tie (defers)", () => {
    // candidate 0.10 vs king 0.071, margin 0.143 -> lead 0.029 < margin -> tie
    expect(decisionWinner(higher(0.1, 0.071), 0.143)).toBe("tie");
    // clearly past the bar -> candidate
    expect(decisionWinner(higher(0.3, 0.071), 0.143)).toBe("candidate");
    // behind is still the king regardless of margin
    expect(decisionWinner(higher(0.0, 0.071), 0.143)).toBe("king");
  });

  it("applies the margin on reversed (fewer-is-better) signals too", () => {
    // candidate 2 invalid vs king-avg 2.75: lead 0.75 < margin 2 -> tie
    expect(decisionWinner(lower(2, 2.75), 2)).toBe("tie");
    // candidate 0 invalid vs king 2.75: lead 2.75 > margin 2 -> candidate
    expect(decisionWinner(lower(0, 2.75), 2)).toBe("candidate");
    // candidate has MORE invalid runs -> behind -> king
    expect(decisionWinner(lower(4, 2.75), 2)).toBe("king");
  });

  it("boundary: a lead exactly equal to the margin is a tie (must exceed)", () => {
    expect(decisionWinner(higher(0.5, 0.0), 0.5)).toBe("tie");
    expect(decisionWinner(higher(0.5001, 0.0), 0.5)).toBe("candidate");
  });
});
