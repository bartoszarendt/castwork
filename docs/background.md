# Background: the TRINITY role model

Agentic Loop's four roles are based on the role model of one paper. This page
says what the paper defines and found, how the project applies it, where the
project goes further, and what it deliberately does not take.

Agentic Loop is based on the TRINITY role model. It is not an implementation of
TRINITY, and it has no learned coordinator.

## Source

Jinglue Xu, Qi Sun, Peter Schwendeman, Stefan Nielsen, Edoardo Cetin, Yujin
Tang. *TRINITY: An Evolved LLM Coordinator.* arXiv:2512.04695, version 3,
27 April 2026. <https://arxiv.org/abs/2512.04695>

Quotations below are from section 3.2 of that version unless another section is
named.

## The three roles

The paper gives each agent turn one of three roles:

- **Thinker:** "analyzes the current state and returns meta-level guidance,
  including high-level plans, decompositions, or critiques of partial
  solutions".
- **Worker:** "acts directly on the task to make concrete progress toward a
  final solution".
- **Verifier:** "checks whether the accumulated solution … is correct,
  complete, and responsive". Its judgement is ACCEPT or REVISE.

A coordinator decides who acts: "At turn k, the coordinator selects an agent
(i.e., an LLM) A_k from the pool and a role R_k". It makes that choice afresh
each turn, of a model and a role together, from the current transcript. The
paper's design rests on the observation that "the coordinator itself need not
be as capable as the underlying agents": in TRINITY it is a small learned model.

## What the paper found

The paper's ablation (Table 2) removes parts of the role design and measures
the effect:

| Configuration | Average | LiveCodeBench | MMLU |
|---|---|---|---|
| Full system | 70.44 | 61.46 | 91.56 |
| Without Thinker-role selection | 68.69 | 57.80 | 92.75 |
| Without tri-role selection | 67.02 | 58.28 | 91.64 |

The table's average covers four benchmarks: LiveCodeBench for coding, MATH500
for mathematics, MMLU for knowledge, and RLPR for reasoning. The full system
has the highest average of every configuration in the table.

Three limits apply to reading these figures:

- **They are the paper's results, not ours.** They measure the paper's learned,
  multi-model system. They are not measurements of this project, of its
  presets, or of renaming roles.
- **The effect is uneven.** Removing Thinker-role selection lowers the average
  and LiveCodeBench, but MMLU rises from 91.56 to 92.75 without it.
- **The headline figure is a different setting.** Section 4.4 reports 86.2 on
  LiveCodeBench, measured on LiveCodeBench V6 with no output-length limit.
  Table 2 uses a limit of 4,096 output tokens. The two figures come from
  different settings and are not comparable with each other.

## How the project applies it

Agentic Loop takes the three roles as responsibility and boundary presets, and
adds the coordinator as a fourth:

| Role | From the paper | Responsibility here | Boundary |
|---|---|---|---|
| `coordinator` | selects an agent and a role each turn | decides which role acts next and on which host; keeps the user informed; records durable decisions | produces nothing, assesses nothing, invents no authorization |
| `thinker` | plans, decompositions, critiques | turns a request into work: intent, scope, out of scope, acceptance criteria, declared requirements; breaks work into tasks; critiques partial results; diagnoses a stall; may recommend the next role | produces no result, records no verdict, drops no declared requirement |
| `worker` | makes concrete progress | produces the smallest result that meets the acceptance criteria; runs the declared checks; records the candidate and evidence, failures included | stays in scope; its own acceptance is never independent; fabricates no evidence |
| `verifier` | checks correct, complete, responsive | assesses the exact recorded candidate: responsive, complete, correct; records a verdict with findings, saying what was and was not checked | read-only on the result; treats no recorded claim as fact; assesses nothing it cannot resolve |

The thinker is responsible for the work, the worker for the candidate and its
evidence, and the verifier for the assessment. That division is guidance in
the presets, not a checked boundary: a record does not say who shaped the work,
and any role may write any entry.

The paper's verdicts map onto the record's: ACCEPT is `accept` and REVISE is
`needs_revision`. The record's `reject` has no counterpart in the paper.

Here the **coordinator is a judgement role**, not a learned model. An agent
following the `coordinator` preset decides what happens next; nothing in the
toolkit selects roles, and no order of roles is required.

**Model binding is the project's alternative to the paper's per-turn model
selection, not an equivalent.** `role_settings.<host>.<role>` in
`agenticloop.json` is fixed configuration: it binds a model, reasoning effort,
and similar settings to each generated role, and it changes only when someone
edits it. Nothing chooses a model per turn. Separating the thinker from the
verifier does let planning and judgement bind different models.

## Where the project goes beyond the paper

The paper names its own limitation (section 6): "the system can devise plans
involving tools but cannot yet act on them". Agentic Loop works in that gap:

- **Grounded work.** Roles act in a real repository, on real files, with real
  checks.
- **Durable records instead of a transcript.** State lives in a Markdown task
  record that outlives the session and any one host.
- **Verdicts bound to an exact candidate.** Evidence and assessments name the
  candidate reference they concern; a new candidate makes them inapplicable.
- **Independence compared by actor.** `independent_review` compares actor
  strings with the candidate's recorded producers, not role names. It is a
  comparison of asserted strings, not a proof of identity, and on its own
  `assessment_roles: [verifier]` does not make the verifier independent; see
  [record-format.md](record-format.md#independence).
- **Declared requirements instead of a single accept.** A task is done when
  its declared requirements are satisfied, not when one verifier says ACCEPT.
- **Human authorization.** The user and the project's policy decide what may
  be done. No role or status grants permission.

## What it does not take

- the learned coordinator;
- the evolutionary optimisation used to train it;
- a fixed turn budget;
- a verifier ACCEPT ending the run;
- the transcript as the state of the work.

These are not adopted. Retry budgets and workflow gates are excluded for the
same reason: agents choose the workflow, and the toolkit only checks what the
record declares.
