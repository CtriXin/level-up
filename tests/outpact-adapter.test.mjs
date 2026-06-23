/**
 * tests/outpact-adapter.test.mjs
 *
 * Unit tests for src/outpact-adapter.mjs.
 * Uses Node.js built-in test runner (node --test).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  candidateToOutpactPacket,
  candidatesToPackets
} from "../src/outpact-adapter.mjs";

// ---------------------------------------------------------------------------
// Fixture helpers — minimal valid candidates (no I/O required)
// ---------------------------------------------------------------------------

const CTX = {
  targetPath: "/some/repo",
  goal: { primaryMetric: { name: "score" } }
};

function makeCandidate(overrides = {}) {
  return {
    id: "baseline-validation",
    title: "Establish a comparable baseline",
    hypothesis: "A reliable baseline makes later decisions safer.",
    expectedImpact: "Improves experiment quality.",
    risk: "Low; may reveal missing scripts.",
    validation: [
      { command: "npm run check", status: "pending" },
      { command: "npm test", status: "pending" }
    ],
    rollback: "Remove the generated baseline artifact.",
    scoreHint: "score",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// candidateToOutpactPacket — baseline-validation → "verification"
// ---------------------------------------------------------------------------

describe("baseline-validation candidate", () => {
  const candidate = makeCandidate({ id: "baseline-validation" });
  const packet = candidateToOutpactPacket(candidate, CTX);

  it("work_type is 'verification'", () => {
    assert.equal(packet.work_type, "verification");
  });

  it("scope.path comes from ctx.targetPath", () => {
    assert.equal(packet.scope.path, CTX.targetPath);
  });

  it("scope.type is 'repo'", () => {
    assert.equal(packet.scope.type, "repo");
  });

  it("task_mode is 'diagnose-first'", () => {
    assert.equal(packet.task_mode, "diagnose-first");
  });

  it("source_refs marks machine origin", () => {
    assert.ok(Array.isArray(packet.source_refs));
    assert.equal(packet.source_refs.length, 1);
    const ref = packet.source_refs[0];
    assert.equal(ref.type, "code");
    assert.ok(ref.ref.startsWith("auto-research/"));
    assert.equal(ref.fetched, true);
  });

  it("source_refs ref contains the candidate id", () => {
    assert.ok(packet.source_refs[0].ref.includes("baseline-validation"));
  });

  it("acceptance comes from candidate.validation array", () => {
    assert.deepEqual(packet.acceptance, candidate.validation);
  });

  it("constraints.rollback_plan comes from candidate.rollback", () => {
    assert.equal(packet.constraints.rollback_plan, candidate.rollback);
  });

  it("action_spec.verb is the candidate id", () => {
    assert.equal(packet.action_spec.verb, "baseline-validation");
  });

  it("action_spec.hypothesis comes from candidate", () => {
    assert.equal(packet.action_spec.hypothesis, candidate.hypothesis);
  });

  it("size_hint is 'small'", () => {
    assert.equal(packet.size_hint, "small");
  });

  it("source_template is 'none'", () => {
    assert.equal(packet.source_template, "none");
  });

  it("non_goals is a non-empty string", () => {
    assert.ok(typeof packet.non_goals === "string" && packet.non_goals.length > 0);
  });

  it("meta sub-object has origin 'auto-research'", () => {
    assert.equal(packet.meta.origin, "auto-research");
  });

  it("meta.candidate_id matches candidate.id", () => {
    assert.equal(packet.meta.candidate_id, "baseline-validation");
  });

  it("meta.risk_hint matches candidate.risk", () => {
    assert.equal(packet.meta.risk_hint, candidate.risk);
  });
});

// ---------------------------------------------------------------------------
// metric-* candidate → "optimize"
// ---------------------------------------------------------------------------

describe("metric-* candidate", () => {
  const candidate = makeCandidate({
    id: "metric-primary-score",
    title: "Improve primary score",
    hypothesis: "A targeted change can improve the metric.",
    expectedImpact: "Moves the primary metric upward."
  });
  const packet = candidateToOutpactPacket(candidate, CTX);

  it("work_type is 'optimize' for metric-* prefix", () => {
    assert.equal(packet.work_type, "optimize");
  });

  it("scope.path comes from ctx, not candidate", () => {
    assert.equal(packet.scope.path, CTX.targetPath);
  });

  it("task_mode is 'diagnose-first'", () => {
    assert.equal(packet.task_mode, "diagnose-first");
  });

  it("source_refs[0].ref contains the metric candidate id", () => {
    assert.ok(packet.source_refs[0].ref.includes("metric-primary-score"));
  });

  it("acceptance matches the validation array", () => {
    assert.deepEqual(packet.acceptance, candidate.validation);
  });

  it("meta.candidate_id is the metric id", () => {
    assert.equal(packet.meta.candidate_id, "metric-primary-score");
  });
});

// ---------------------------------------------------------------------------
// decision-doc → "other"
// ---------------------------------------------------------------------------

describe("decision-doc candidate", () => {
  const candidate = makeCandidate({
    id: "decision-doc",
    title: "Record the experiment decision surface",
    hypothesis: "Documenting metric before mutation makes runs easier to audit.",
    expectedImpact: "Improves handoff quality."
  });
  const packet = candidateToOutpactPacket(candidate, CTX);

  it("work_type is 'other'", () => {
    assert.equal(packet.work_type, "other");
  });

  it("task_mode is 'diagnose-first'", () => {
    assert.equal(packet.task_mode, "diagnose-first");
  });

  it("scope.path comes from ctx", () => {
    assert.equal(packet.scope.path, CTX.targetPath);
  });

  it("source_refs marks machine source", () => {
    assert.equal(packet.source_refs[0].fetched, true);
    assert.ok(packet.source_refs[0].ref.includes("decision-doc"));
  });

  it("acceptance comes from candidate.validation", () => {
    assert.deepEqual(packet.acceptance, candidate.validation);
  });
});

// ---------------------------------------------------------------------------
// guardrail-hardening → "optimize"
// ---------------------------------------------------------------------------

describe("guardrail-hardening candidate", () => {
  const candidate = makeCandidate({ id: "guardrail-hardening" });
  const packet = candidateToOutpactPacket(candidate, CTX);

  it("work_type is 'optimize'", () => {
    assert.equal(packet.work_type, "optimize");
  });
});

// ---------------------------------------------------------------------------
// code-health-simplification → "optimize"
// ---------------------------------------------------------------------------

describe("code-health-simplification candidate", () => {
  const candidate = makeCandidate({ id: "code-health-simplification" });
  const packet = candidateToOutpactPacket(candidate, CTX);

  it("work_type is 'optimize'", () => {
    assert.equal(packet.work_type, "optimize");
  });
});

// ---------------------------------------------------------------------------
// unknown id → "research"
// ---------------------------------------------------------------------------

describe("unknown candidate id", () => {
  const candidate = makeCandidate({ id: "some-future-experiment" });
  const packet = candidateToOutpactPacket(candidate, CTX);

  it("work_type falls back to 'research'", () => {
    assert.equal(packet.work_type, "research");
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("candidateToOutpactPacket errors", () => {
  it("throws if ctx.targetPath is missing", () => {
    assert.throws(
      () => candidateToOutpactPacket(makeCandidate(), { goal: {} }),
      /targetPath/
    );
  });

  it("throws if candidate is null", () => {
    assert.throws(
      () => candidateToOutpactPacket(null, CTX),
      /candidate/
    );
  });
});

// ---------------------------------------------------------------------------
// candidatesToPackets — batch convenience function
// ---------------------------------------------------------------------------

describe("candidatesToPackets", () => {
  const ideationResult = {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    slot: "ideation",
    skipped: false,
    candidates: [
      makeCandidate({ id: "baseline-validation" }),
      makeCandidate({ id: "metric-speed" }),
      makeCandidate({ id: "decision-doc" })
    ]
  };

  const packets = candidatesToPackets(ideationResult, CTX);

  it("returns an array of the same length as candidates", () => {
    assert.equal(packets.length, 3);
  });

  it("each packet has scope.path from ctx", () => {
    for (const p of packets) {
      assert.equal(p.scope.path, CTX.targetPath);
    }
  });

  it("work_types are mapped correctly across the batch", () => {
    assert.equal(packets[0].work_type, "verification");
    assert.equal(packets[1].work_type, "optimize");
    assert.equal(packets[2].work_type, "other");
  });

  it("throws if candidates is not an array", () => {
    assert.throws(
      () => candidatesToPackets({ candidates: null }, CTX),
      /candidates/
    );
  });
});
