/**
 * outpact-adapter.mjs — pure adapter that maps auto-research candidates to
 * outpact dispatch packets (packet v2, output-contract.md).
 *
 * Constraints:
 * - Pure functions only; no file I/O, no side effects.
 * - Does NOT import state-core, autopilot, strategy, evaluator, apply, or any
 *   other execution-environment module.
 * - scope MUST come from ctx; never fabricated.
 * - Enum values are sourced from outpact/references/output-contract.md.
 */

// ---------------------------------------------------------------------------
// work_type mapping table
// ---------------------------------------------------------------------------
// Sourced from output-contract.md enum:
//   new-build | copy | optimize | fix | diagnose
//   add-ads | remove-ads | verification
//   redirect | upload | config
//   research | audit | cms | other | ambiguous
//
// decision-doc → "other": the candidate only writes a doc, no code change.
//   "audit" was considered but audit implies reviewing existing artifacts;
//   here we are *creating* a new doc. "other" is the closest legal value.
// unknown id → "research": machine-generated unknown types are best treated
//   as research until a human or mommy can re-classify.
const WORK_TYPE_MAP = {
  "baseline-validation": "verification",
  "guardrail-hardening": "optimize",
  "code-health-simplification": "optimize",
  "decision-doc": "other"
};

function resolveWorkType(candidateId) {
  if (candidateId.startsWith("metric-")) return "optimize";
  return WORK_TYPE_MAP[candidateId] ?? "research";
}

// ---------------------------------------------------------------------------
// task_mode
// ---------------------------------------------------------------------------
// We use "diagnose-first" uniformly.
// Rationale: these packets are machine-generated improvement directions.
//   A human or mommy director should inspect before executing.
//   "audit-only" was rejected: it is detection-only and strips the
//   improvement intent (the packet would become read-only).
//   "diagnose-first" is a legal value per output-contract.md task_mode enum
//   and correctly signals "inspect before acting".
const TASK_MODE = "diagnose-first";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a single auto-research candidate to an outpact dispatch packet.
 *
 * @param {object} candidate  A candidate from generateCandidates().candidates[].
 *   Shape: { id, title, hypothesis, expectedImpact, risk,
 *            validation:[{command,status}], rollback, scoreHint }
 * @param {object} ctx        Caller-provided context.
 *   Shape: { targetPath: string, goal: object }
 * @returns {object}  outpact packet (packet v2) with meta sub-object for mommy.
 */
export function candidateToOutpactPacket(candidate, ctx) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("candidateToOutpactPacket: candidate must be an object");
  }
  if (!ctx || typeof ctx.targetPath !== "string" || !ctx.targetPath) {
    throw new Error("candidateToOutpactPacket: ctx.targetPath (string) is required");
  }

  const workType = resolveWorkType(candidate.id);

  // acceptance: output-contract says optimize → metric; diagnose/research →
  // output-format/report. We carry the raw validation array so the downstream
  // director can inspect commands and decide. If a string list is needed, each
  // entry's .command field provides it.
  const acceptance = Array.isArray(candidate.validation)
    ? candidate.validation
    : [];

  const packet = {
    // ---- 10 standard outpact fields (output-contract.md, packet v2) --------
    scope: {
      path: ctx.targetPath,
      type: "repo"
    },
    work_type: workType,
    action_spec: {
      verb: candidate.id,
      summary: candidate.title,
      hypothesis: candidate.hypothesis,
      expected_impact: candidate.expectedImpact
    },
    task_mode: TASK_MODE,
    source_refs: [
      {
        type: "code",
        ref: `auto-research/${candidate.id}`,
        fetched: true  // this module generated it from the candidate in-memory
      }
    ],
    source_template: "none",
    constraints: {
      rollback_plan: candidate.rollback
    },
    acceptance,
    size_hint: "small",
    non_goals:
      "仅限该候选的实验范围；不做候选目标之外的改动",

    // ---- meta sub-object for downstream mommy (non-outpact standard) -------
    // Kept in a sub-object to avoid polluting the flat outpact namespace while
    // still allowing mommy / other directors to inspect machine provenance.
    meta: {
      origin: "auto-research",
      candidate_id: candidate.id,
      risk_hint: candidate.risk
    }
  };

  return packet;
}

/**
 * Convenience: map all candidates from generateCandidates() output to packets.
 *
 * @param {object} ideationResult  Return value of generateCandidates().
 *   Shape: { candidates: [...], version, generatedAt, slot, skipped }
 * @param {object} ctx             Same ctx as candidateToOutpactPacket().
 * @returns {object[]}  Array of outpact packets, one per candidate.
 */
export function candidatesToPackets(ideationResult, ctx) {
  if (!ideationResult || !Array.isArray(ideationResult.candidates)) {
    throw new Error(
      "candidatesToPackets: ideationResult.candidates must be an array"
    );
  }
  return ideationResult.candidates.map((c) => candidateToOutpactPacket(c, ctx));
}
