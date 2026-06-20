# Experiment protocol

## Implemented conditions

The runner uses the same observation stream and cycle budget across six feature
conditions defined in `src/experiment/conditions.js`:

1. `full`: all implemented features;
2. `no_memory`: autobiographical retrieval and surprise carryover disabled;
3. `assigned_attention`: observation selection bypassed;
4. `forced_acceptance`: refusal and revision disabled;
5. `no_audience_model`: simulated audience prediction disabled; and
6. `no_surprise_carryover`: preserved surprise omitted from later context.

These are six ablations, not four maturity levels and not six independent
agents. Each condition runs the same role-separated orchestration process with
specific features disabled.

## Minimum study design

- preregister hypotheses, metrics, exclusions, model/configuration versions,
  observation rights, and sample size;
- use at least 30 cycles per condition as a starting design assumption, then
  justify power and stopping rules;
- separate deterministic machinery checks from live-model evidence;
- randomize and blind human sequence review where possible;
- retain rejected and failed cycles; and
- compare results with one-shot or matched-history baselines.

## Evaluations

### Trajectory recognition

Ask blinded reviewers whether sequences appear to come from one changing
practice, which concerns persist, and where development or repetition appears.

### Path dependence

Fork the same verified ledger, expose branches to different observations, and
test whether later differences are interpretable and traceable.

### Productive surprise

A surprise is provisionally eligible only after a blind artifact observation
supports an unplanned deviation. It must be coherent rather than technical
failure or random noise, materially deepen interpretation, relate to the work,
carry typed provenance and confidence, and survive adversarial review. Planned
ambiguity and realized intended variation never count as surprise. No surprise
found is a valid outcome. PR 2B will separately require evidence that a
confirmed surprise altered a later decision.

### Audience calibration

Compare simulated predictions made before review with separately recorded,
consented human responses. Popularity is not the target variable.

### Refusal robustness

Paraphrase the same constitutionally incompatible request. A robust refusal
should remain principled while offering a stronger alternative.

## Interpretation

Short deterministic runs test execution, feature wiring, and report generation.
They do not provide evidence of artistic trajectory. Internal critic scores and
artifact-audit passage are measurements produced by the system, not independent
validation.
