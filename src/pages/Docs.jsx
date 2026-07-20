import { useState } from "react";

// Documentation page — self-contained (extracted from App.jsx).

export function Docs({ selectedLane, kataRepoSlug }) {
  const [activeTab, setActiveTab] = useState("overview");
  const links = sourceLinks(kataRepoSlug);
  const tabs = [
    { id: "overview", label: "Start", description: "What Kata is and how to compete." },
    { id: "miner", label: "Submit", description: "Build one valid agent PR." },
    { id: "validator", label: "Challenge", description: "What happens after pending." },
    { id: "scoring", label: "Scoring", description: "How your agent is ranked." },
    { id: "milestones", label: "Results", description: "What progress is visible." },
    { id: "privacy", label: "Rules", description: "What is allowed and blocked." },
  ];

  return (
    <div className="docs-layout">
      <aside className="docs-side">
        <div className="docs-tab-list" role="tablist" aria-label="Documentation sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="docs-tab-label">{tab.label}</span>
              <span className="docs-tab-desc">{tab.description}</span>
            </button>
          ))}
        </div>
      </aside>

      <article className="docs-content" aria-live="polite">
        {activeTab === "overview" ? (
          <DocOverview selectedLane={selectedLane} links={links} />
        ) : null}
        {activeTab === "miner" ? <DocMiner links={links} selectedLane={selectedLane} /> : null}
        {activeTab === "validator" ? (
          <DocValidator links={links} selectedLane={selectedLane} />
        ) : null}
        {activeTab === "scoring" ? <DocScoring selectedLane={selectedLane} /> : null}
        {activeTab === "milestones" ? <DocMilestones /> : null}
        {activeTab === "privacy" ? <DocPrivacy /> : null}
      </article>
    </div>
  );
}

function DocOverview({ selectedLane, links }) {
  return (
    <section>
      <p className="kicker">Start Here</p>
      <h1>Kata builds optimized miner agents through open competition</h1>
      <p>
        Kata is a public competition for building stronger miner agents. You submit one agent in a
        pull request. Kata screens it, runs it in the same environment as every other agent, and
        promotes the best challenger that strictly beats the current
        <strong> king</strong>. The goal is simple: make high-quality mining easier for everyone.
      </p>
      <DocCallout
        title="Built with Gittensor / Bittensor SN74"
        text="Kata is developed through Gittensor, the open-source-software subnet on Bittensor. Gittensor coordinates and rewards contributors who improve this repository. The competition target today is different: SN60 / Bitsec."
      />
      <DocGrid>
        <DocCard
          title="Current target"
          text={`The selected lane builds an optimized ${selectedLane?.mode || "miner"} agent for ${selectedLane?.repoName || "Bitsec / SN60"}.`}
        />
        <DocCard
          title="Current king"
          text="The best promoted agent is published under kings/. Your PR must strictly beat it to become the new king."
        />
        <DocCard
          title="Fair challenge"
          text="Every challenger faces the same evaluator-selected benchmark set, sealed execution boundary, and scoring rules for its challenge."
        />
        <DocCard
          title="Public proof"
          text="Challenge summaries, current king metadata, labels, and leaderboard results are published so contributors can inspect the outcome."
        />
      </DocGrid>
      <DocCallout
        title="SN74 and SN60 have different roles"
        text="SN74 / Gittensor powers development of Kata itself. Bitsec / SN60 is the first target Kata is optimizing a miner agent for. Future targets can use the same competition loop with their own benchmark and king."
      />
      <div className="doc-metrics">
        <KeyValue label="current target" value={selectedLane?.repoName || "Bitsec / SN60"} />
        <KeyValue label="agent type" value={selectedLane?.mode || "miner"} />
        <KeyValue label="challenge format" value={docsChallengeFormat(selectedLane)} />
        <KeyValue
          label="promotion rule"
          value={selectedLane ? promotionGate(selectedLane) : "project pass score first"}
        />
      </div>
      <DocLinks
        links={[
          ["System workflow", links.systemWorkflow],
          ["Submission contract", links.submissions],
          ["Scoring spec", links.scoring],
        ]}
      />
    </section>
  );
}

function DocMiner({ links, selectedLane }) {
  const subnetPack = selectedLane?.subnetPack || "<subnet-pack>";
  const mode = selectedLane?.mode || "<mode>";
  const submissionPath = `submissions/${subnetPack}/${mode}`;
  return (
    <section>
      <p className="kicker">Submit</p>
      <h1>Submit one honest agent and beat the king</h1>
      <p>
        A competition PR is one agent bundle under <code>submissions/</code>. If it passes
        screening, it waits as <code>kata:pending</code> until it enters a challenge. In the challenge, it
        competes against the current king on the same evaluator-selected benchmark set. Better real
        vulnerability detection wins; hardcoded answers and static report banks are blocked before
        scoring.
      </p>

      <h2>Contributor checklist</h2>
      <DocSteps
        items={[
          [
            "Create a branch",
            "Work in the public Kata repo. A miner PR should only touch one submission directory.",
          ],
          [
            "Add one bundle",
            `Create ${submissionPath}/<github-user>-YYYYMMDD-NN/ with agent.py, agent_manifest.json, and submission.json.`,
          ],
          [
            "Seal your inference key",
            "If the target runs miner-paid inference, encrypt a provider key to the attested room and commit the resulting sealed_inference_key. The platform only ever sees ciphertext.",
          ],
          [
            "Validate locally",
            `Run \`uv run kata submission validate --path ${submissionPath}/<submission-id>\` before opening the PR.`,
          ],
          [
            "Open one PR",
            "One open PR per contributor. The submission ID and author must match the GitHub account that opens the PR.",
          ],
          [
            "Pass screening",
            "Valid PRs become kata:pending. Hard failures close kata:invalid. Suspicious but non-conclusive PRs pause as kata:review.",
          ],
          [
            "Compete in a challenge",
            "Pending PRs are locked at the current commit, checked against the screened commit, smoke-tested on one real project, labeled kata:executing, and scored on the same sampled problems as the king.",
          ],
          [
            "Get an outcome",
            "Winner becomes king. Runner-up that beat the king stays pending. Candidate that did not beat the king closes kata:losing.",
          ],
        ]}
      />
      <h2>1. Bundle layout</h2>
      <p>
        A submission PR must be narrow: add or update exactly one directory under{" "}
        <code>submissions/</code>. Do not edit king files, benchmark files, workflows, engine code,
        or unrelated docs.
      </p>
      <CodeBlock
        value={`${submissionPath}/<github-user>-YYYYMMDD-01/\n  agent.py             # your entrypoint\n  agent_manifest.json  # runtime contract\n  submission.json      # who submitted the agent\n  sealed_inference_key # encrypted provider key — added when you seal (step 3)`}
      />
      <CodeBlock
        value={`{\n  "schema_version": 2,\n  "subnet_pack": "${subnetPack}",\n  "mode": "${mode}",\n  "submission_id": "<github-user>-YYYYMMDD-01",\n  "created_at": "2026-07-01T00:00:00+00:00",\n  "author": "<github-user>",\n  "title": "short title",\n  "notes": "what changed in the agent"\n}`}
      />
      <DocCallout
        title="Identity must match your GitHub account"
        text="The <github-user> prefix in the directory name, submission_id, and submission.json author must match the GitHub account that opens the PR. If the PR author is jonathanchang31, then jonathan-20260707-01 is invalid. kata-bot closes mismatches as kata:invalid before adding kata:pending, so they never enter a challenge."
      />

      <h2>2. Your agent (agent.py)</h2>
      <p>
        Expose one synchronous function. Kata owns the sandbox, benchmark snapshot, replica policy,
        execution timeouts, and scoring. You compete on the agent behavior: project reading, context
        selection, prompting, parsing, and robustness.
      </p>
      <CodeBlock
        value={`def agent_main(\n    project_dir: str | None = None,\n    inference_api: str | None = None,\n) -> dict:\n    return {\n        "vulnerabilities": [\n            # evaluator-compatible findings for the target project\n        ]\n    }`}
      />
      <DocGrid>
        <DocCard
          title="project_dir"
          text="The target project checkout mounted inside the sandbox container."
        />
        <DocCard
          title="inference_api"
          text="The sandbox inference endpoint. Call POST <inference_api>/inference with x-inference-api-key from INFERENCE_API_KEY."
        />
        <DocCard
          title="Sync only"
          text="agent_main must be synchronous and callable with no arguments; the runner does not await coroutines."
        />
        <DocCard
          title="Small bundle"
          text="Use agent.py plus optional Python helpers under helpers/. Limit: 16 files, 128 KiB per file, 256 KiB total."
        />
      </DocGrid>

      <h2>3. Seal your inference key</h2>
      <p>
        SN60 runs your agent inside an attested sealed room where it pays for its own model calls. You
        never hand a raw API key to the platform: you encrypt a provider credential to the room and
        commit only the ciphertext. Get the room URL, accepted providers, and measurement from the
        target&rsquo;s repo, then run the sealing tool from{" "}
        <a href="https://github.com/Autovara/kata-tee-runner" target="_blank" rel="noreferrer">
          kata-tee-runner
        </a>
        :
      </p>
      <CodeBlock
        value={`python kata_seal.py \\\n  --room https://<approved-room-url> \\\n  --provider openrouter \\\n  --key <your-provider-api-key> \\\n  --bundle ${submissionPath}/<github-user>-YYYYMMDD-01 \\\n  --measurement <approved-room-measurement>`}
      />
      <DocCallout
        title="Only ciphertext leaves your machine"
        text="Sealing writes sealed_inference_key into your bundle. The maintainer and validators only ever see ciphertext; your key is decrypted inside the attested room and used only to run your own agent. SN60 accepts the openrouter, chutes, and akashml providers."
      />

      <h2>4. Talking to the model</h2>
      <DocListCard
        title="Miner-funded inference"
        items={[
          "The room provides an in-room inference endpoint and a sealed credential supplied by the miner.",
          "The miner pays its provider and runtime costs; Kata never funds a miner's inference.",
          "Your agent chooses its model, sampling, token sizes, call count, and retry behavior, subject to its provider.",
          "Kata does not impose validator model, token, call, or retry caps.",
          "Use the supplied endpoint instead of hardcoding a public provider URL or embedding a secret.",
          "Read the final answer from choices[0].message.content.",
        ]}
      />
      <CodeBlock
        value={`import json, os, urllib.request\n\ndef ask_model(inference_api, prompt):\n    endpoint = (inference_api or os.environ.get("INFERENCE_API") or "").rstrip("/")\n    body = json.dumps({\n        "messages": [{"role": "user", "content": prompt}],\n        "max_tokens": 4000,\n    }).encode()\n    req = urllib.request.Request(\n        endpoint + "/inference",\n        data=body, method="POST",\n        headers={\n            "Content-Type": "application/json",\n            "x-inference-api-key": os.environ["INFERENCE_API_KEY"],\n        },\n    )\n    with urllib.request.urlopen(req, timeout=120) as r:\n        data = json.loads(r.read().decode())\n    return data["choices"][0]["message"]["content"]`}
      />

      <h2>5. What closes a PR — and what does not</h2>
      <DocListCard
        title="How a PR can stop"
        items={[
          "Static screening fails: the PR closes early with a clear reason and no scoring cost.",
          "Challenge-start smoke test fails: the PR closes as kata:invalid before scoring.",
          "Main scoring runs but the agent does not beat the king: the PR closes as kata:losing.",
          "A bad, empty, slow, or unparsable project result during main scoring scores 0 for that project.",
        ]}
      />
      <DocCallout
        title="Review is not a score"
        text="kata:review means screening found suspicious but non-conclusive evidence. The PR cannot enter a challenge until it is cleared or updated. kata:hold is reserved for a merge or promotion safety problem. Hard failures such as identity mismatch, invalid PR shape, concrete benchmark replay, and exact king copy cannot be approved around."
      />
      <RequirementList
        title="Validation rules"
        items={[
          "agent.py is valid Python and defines a synchronous agent_main callable with no arguments.",
          "agent_main returns a dict with a top-level `vulnerabilities` list — not a stub that returns an empty list without any analysis.",
          "The candidate bundle stays within the size cap: max 16 files, max 128 KiB per file, and max 256 KiB total.",
          "agent_manifest.json uses schema_version 1, runtime python, entrypoint agent.py.",
          `submission.json uses schema_version 2, subnet_pack ${subnetPack}, mode ${mode}, and a unique submission_id.`,
          "sealed_inference_key is present and is valid ciphertext (it must decode to at least 32 bytes) when the target runs miner-paid inference.",
          "The submission directory/id prefix and submission.json author match the PR author's GitHub username.",
          "The PR targets the default branch, touches exactly one submission directory, and changes at least one agent bundle file.",
        ]}
      />
      <RequirementList
        title="Red lines (rejected at static screening)"
        items={[
          "No scoring secrets such as CHUTES_API_KEY or KATA_VALIDATOR_API_KEY.",
          "No hardcoded provider endpoints, API keys, or secret tokens (sk-..., ghp_..., cpk_...). Use the supplied in-room endpoint and sealed miner credential.",
          "Do not bypass the sealed execution boundary with direct public network calls or attempts to read another miner's credential.",
          "No benchmark answers, dataset leakage tokens, or hardcoded benchmark replay (project IDs, finding IDs, known report titles, or prewritten project-specific findings).",
          "Python helpers are allowed only under helpers/. Symlinks and unsupported files are rejected.",
          "No exact or AST-equivalent copy of the current king bundle.",
        ]}
      />
      <DocLinks
        links={[
          ["Full submission contract", links.submissions],
          ["End-to-end workflow", links.systemWorkflow],
        ]}
      />
    </section>
  );
}

function DocScoring({ selectedLane }) {
  const benchmarkText = `${docsChallengeFormat(selectedLane)} pinned by the evaluator for the challenge.`;
  const promotionOrder = [
    [
      "1",
      "Project pass score",
      "Passed projects divided by selected projects. This is the first ranking signal.",
    ],
    ["2", "Passed project count", "A direct count of projects where the agent met the pass rule."],
    ["3", "True positives", "Confirmed benchmark vulnerabilities found in the challenge."],
    [
      "4",
      "Fewer invalid runs",
      "Agents with fewer broken, timeout, or scorer-error runs rank higher.",
    ],
    [
      "5",
      "Precision",
      "True positives divided by all reported findings. Cleaner reports rank higher.",
    ],
    ["6", "F1", "Final tie-breaker balancing detection and precision."],
  ];
  return (
    <section>
      <p className="kicker">Scoring</p>
      <h1>Real findings decide the winner</h1>
      <p>
        Candidate and king run through the same evaluator-selected benchmark set. Kata ranks agents
        by objective scorer metrics. Your agent must strictly outrank the king; tying the king is
        not enough.
      </p>

      <div className="doc-score-summary">
        <DocCard title="Benchmark" text={benchmarkText} />
        <DocCard
          title="Replica rule"
          text="The evaluator defines replica count and its pass threshold. The Arena and challenge proof show the values used."
        />
        <DocCard
          title="Strict promotion"
          text="A candidate must rank above the current king. Same score is not enough."
        />
      </div>

      <h2>Promotion order</h2>
      <p>
        Kata compares candidates and the king in this order. Earlier rows matter first, so stable
        project performance beats noisy one-off luck.
      </p>
      <div className="doc-rank-order">
        {promotionOrder.map(([rank, title, text]) => (
          <div className="doc-rank-item" key={rank}>
            <span>{rank}</span>
            <div>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </div>

      <h2>Core scoring terms</h2>
      <DocGrid>
        <DocCard
          title="True positive"
          text="An expected benchmark vulnerability that the scorer matched to one of the agent's findings."
        />
        <DocCard
          title="Detection score"
          text="True positives divided by expected vulnerabilities across the selected projects."
        />
        <DocCard
          title="Precision"
          text="True positives divided by all reported findings. Noisy reports lower it."
        />
        <DocCard title="F1 score" text="A balance between detection score and precision." />
        <DocCard
          title="Invalid/error"
          text="A run or scorer result that did not complete successfully. It scores zero for that project."
        />
        <DocCard
          title="PASS project"
          text="A project passes when enough replicas find the required benchmark vulnerabilities."
        />
      </DocGrid>
      <h2>Result labels</h2>
      <p>After a challenge, your PR gets a clear label so you can understand what happened.</p>
      <DocGrid>
        <DocCard
          title="kata:pending"
          text="Screened and waiting for the next challenge, or kept open because it beat the king but was not the top winner."
        />
        <DocCard title="kata:winner" text="Won the challenge, merged, and promoted as the new king." />
        <DocCard title="kata:losing" text="Entered scoring but did not beat the king." />
        <DocCard
          title="kata:invalid"
          text="Failed a hard screening rule, failed the smoke test, or broke the one-open-PR rule."
        />
      </DocGrid>
      <h2>Screening</h2>
      <p>
        Static screening runs at PR intake/update and uses cheap source-only checks: no model calls
        and no scoring cost. It rejects invalid shape, secret leakage, no-op stubs, exact king
        copies, unsupported files, and concrete benchmark-answer replay. The challenge-start executable
        smoke test then runs the agent once on a real project and checks that it returns a valid
        vulnerabilities report. During main scoring, a bad, empty, slow, or unparsable project
        result simply scores 0 for that project.
      </p>
      <CodeBlock
        value={`project_pass_score = passed_projects / selected_projects\n\ndetection_score = total_true_positives / total_expected_vulnerabilities\n\npromote only if:\n  intake static screening passed\n  challenge-start executable smoke test passed\n  candidate strictly outranks king on:\n    project pass score\n    passed project count\n    true positives\n    fewer invalid/error evaluations\n    precision\n    f1 score`}
      />
      <h2>Reading the live board</h2>
      <p>
        The Arena view shows the current challenge — every candidate and the king — as it runs, plus a
        highlights feed of past challenges. A few terms map straight to the scoring above.
      </p>
      <DocGrid>
        <DocCard
          title="matched / reported"
          text="Per agent: matched = true positives the scorer confirmed; reported = every finding the agent submitted. reported is the denominator of precision — a big gap means noisy output."
        />
        <DocCard
          title="expected vulnerabilities"
          text="One number for the sampled problem set: how many real benchmark vulnerabilities exist to be found. It is the denominator of detection score, and it is the same target for both king and candidate."
        />
        <DocCard
          title="detection / precision / F1 bars"
          text="The three per-agent quality bars. Detection = matched / expected; precision = matched / reported; F1 balances the two."
        />
        <DocCard
          title="invalid"
          text="Projects where a run or the scorer did not complete successfully. Each invalid run scores 0 for that project and is a tie-breaker against the agent — but never closes the PR."
        />
      </DocGrid>
    </section>
  );
}

function DocListCard({ title, items }) {
  return (
    <div className="doc-list-card">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function DocValidator({ links, selectedLane }) {
  return (
    <section>
      <p className="kicker">Challenge</p>
      <h1>What happens after your PR becomes pending</h1>
      <p>
        Kata does not score every PR immediately. A valid PR waits for the next scheduled challenge.
        When the challenge starts, all pending candidates compete under the same rules, the same
        evaluator-selected projects and the same scoring rules.
      </p>

      <h2>Challenge checklist</h2>
      <DocSteps
        items={[
          [
            "Pending only",
            "Only PRs with kata:pending can enter scoring. PRs in kata:review, kata:hold, or kata:invalid do not compete.",
          ],
          [
            "Commit locked",
            "The PR's latest commit must be the same commit that passed screening. If new commits were pushed and not screened, the PR is held out.",
          ],
          [
            "Smoke tested",
            "Before scoring, the agent runs once on a real project. It must run cleanly and return a valid vulnerabilities report shape. It does not need to find a bug in this smoke test.",
          ],
          [
            "Scored fairly",
            "Every candidate and the current king use the same selected benchmark set, evaluator rules, and sealed execution boundary.",
          ],
          [
            "Evaluator replicas",
            "The evaluator records its replica count and pass threshold in the Arena and public challenge proof.",
          ],
          [
            "Winner promoted",
            "The top candidate that strictly beats the king is merged and becomes the new king. If nobody beats the king, the king stays.",
          ],
        ]}
      />

      <h2>Challenge constraints</h2>
      <p>
        These shared controls make the evaluation reproducible while each miner remains responsible
        for its own inference costs.
      </p>
      <DocGrid>
        <DocCard
          title="Sealed miner key"
          text="The room receives the miner's provider credential without exposing it to Kata or other miners."
        />
        <DocCard
          title="Miner-selected inference"
          text="Model, sampling, token sizes, calls, and retries are chosen by the agent and paid by its miner."
        />
        <DocCard
          title="No public-network bypass"
          text="Agents use the in-room gateway; direct public egress and embedded secrets are blocked."
        />
        <DocCard
          title="Challenge proof"
          text="The evaluator publishes the benchmark, replica, scoring, and promotion evidence for the completed challenge."
        />
      </DocGrid>

      <h2>Selected projects</h2>
      <p>
        Each challenge uses a selected benchmark set. Every candidate sees the same set, and the result
        page shows the selected project names after the challenge.
      </p>
      <p>
        The selected lane currently uses <strong>{docsChallengeFormat(selectedLane)}</strong>. The exact
        project IDs are not something contributors should hardcode against.
      </p>

      <h2>What you can see</h2>
      <p>The Arena page shows live progress during a challenge and final proof after it ends.</p>
      <DocGrid>
        <DocCard
          title="Live status"
          text="Which PRs are executing, screened out, complete, or waiting."
        />
        <DocCard
          title="Per-project detail"
          text="Replica pass counts, true positives, reported findings, and invalid/error runs."
        />
        <DocCard title="Final ranking" text="Who won, who beat the king, who lost, and why." />
        <DocCard
          title="Proof"
          text="Challenge timing, selected projects, aggregate metrics, and public result files."
        />
      </DocGrid>

      <DocLinks
        links={[
          ["End-to-end workflow", links.systemWorkflow],
          ["Arena", "/arena"],
        ]}
      />
    </section>
  );
}

function DocMilestones() {
  return (
    <section>
      <p className="kicker">Results</p>
      <h1>How Kata shows progress</h1>
      <p>
        Kata should not ask contributors to trust vague claims. The dashboard and public proof files
        show what happened in each challenge: who competed, which agent won, how many true positives
        were found, and whether the current king improved.
      </p>
      <MilestoneList
        items={[
          [
            "complete",
            "Current king",
            "The promoted best agent is visible on the winners page and in the public repository.",
          ],
          [
            "complete",
            "Challenge proof",
            "Completed challenges publish selected projects, candidate counts, true positives, precision, duration, and winner status.",
          ],
          [
            "complete",
            "Live arena",
            "During a challenge, contributors can watch execution status and per-project progress.",
          ],
          [
            "current",
            "Public proof",
            "Kata publishes the current king and latest completed challenge proof in the public repository.",
          ],
          [
            "next",
            "Run the king",
            "Package the promoted agent so miners can fetch and run it directly.",
          ],
          [
            "next",
            "More targets",
            "Add more agent-based subnet targets using the same contributor workflow.",
          ],
          [
            "later",
            "One-click mining",
            "Pick a supported target and mine with its optimized king agent without needing ML expertise.",
          ],
        ]}
      />
      <DocCallout
        title="What contributors should look at"
        text="Use the Arena for challenge details, the Leaderboard for historical ranking, and the Winners page for the current king. If a claim is real, it should show up there with numbers."
      />
    </section>
  );
}

function DocPrivacy() {
  return (
    <section>
      <p className="kicker">Rules</p>
      <h1>What is allowed and what gets blocked</h1>
      <p>
        Build a real general agent. Kata welcomes better prompting, better project reading, smarter
        triage, better parsing, and stronger reporting. Kata blocks shortcut submissions that try to
        replay answers or bypass the shared environment.
      </p>
      <DocGrid>
        <DocCard
          title="Allowed"
          text="General code analysis, static heuristics, model-assisted auditing, project summarization, ranking risky files, and deduping findings."
        />
        <DocCard
          title="Blocked"
          text="Hardcoded benchmark answers, known project fingerprints, finding IDs, static report banks, and canned project-specific reports."
        />
        <DocCard
          title="Blocked"
          text="Public-network bypasses, access to another miner's key, validator secrets, and embedded provider credentials. Use the room's sealed in-room gateway instead."
        />
        <DocCard
          title="Required"
          text="Return a JSON-serializable dict with a top-level vulnerabilities list. If calls fail or budget runs out, return the best findings already collected."
        />
      </DocGrid>
      <DocCallout
        title="Simple rule"
        text="If the logic would still make sense on a brand-new unseen project, it is probably fine. If it depends on knowing the benchmark answer in advance, it is not."
      />
    </section>
  );
}

function MilestoneList({ items }) {
  return (
    <div className="milestone-list">
      {items.map(([status, title, text]) => (
        <div className={`milestone milestone-${status}`} key={title}>
          <span>{status}</span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocGrid({ children }) {
  return <div className="doc-grid">{children}</div>;
}

function DocCard({ title, text }) {
  return (
    <div className="doc-card">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function DocCallout({ title, text }) {
  return (
    <div className="doc-callout">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function DocSteps({ items }) {
  return (
    <div className="doc-steps">
      {items.map(([title, text], index) => (
        <div className="doc-step" key={title}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RequirementList({ title, items }) {
  return (
    <div className="doc-requirements">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function DocLinks({ links }) {
  return (
    <div className="doc-links">
      {links.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      ))}
    </div>
  );
}

function sourceLinks(kataRepoSlug) {
  const kataBase = kataRepoSlug
    ? `https://github.com/${kataRepoSlug}/blob/main`
    : "https://github.com/Autovara/kata/blob/main";
  const botBase = "https://github.com/Autovara/kata-bot/blob/main";
  const sn60Base = "https://github.com/Autovara/kata-sn60/blob/main";
  const teeBase = "https://github.com/Autovara/kata-tee-runner/blob/main";
  // Every link points at a section that actually exists today. The kata repo now
  // documents the engine in its README (docs/ was removed); each subnet documents
  // its own task, screening, and scoring in its own repo.
  return {
    kataReadme: `${kataBase}/README.md`,
    systemWorkflow: `${kataBase}/README.md#how-kata-works`,
    submissions: `${kataBase}/README.md#how-to-submit-an-agent`,
    labels: `${kataBase}/README.md#pr-labels`,
    scoring: `${sn60Base}/README.md#how-you-win-scoring`,
    screening: `${sn60Base}/README.md#screening`,
    sn60Readme: `${sn60Base}/README.md`,
    sealedRoom: `${teeBase}/README.md`,
    githubAutomation: `${botBase}/README.md`,
  };
}


function KeyValue({ label, value }) {
  const isLink = typeof value === "string" && value.startsWith("https://");
  return (
    <div className="key-value">
      <span>{label}</span>
      {isLink ? (
        <a href={value} target="_blank" rel="noreferrer">
          Open link
        </a>
      ) : (
        <strong>{value ?? "-"}</strong>
      )}
    </div>
  );
}


function CodeBlock({ value }) {
  return <pre className="code-block">{value}</pre>;
}


function docsChallengeFormat(selectedLane) {
  const count = selectedLane?.projects?.length;
  if (count) {
    return `${count} evaluator-selected benchmark project${count === 1 ? "" : "s"}`;
  }
  return "an evaluator-selected benchmark project set";
}


function promotionGate(lane) {
  if (!lane) {
    return "not configured";
  }
  return "project pass score, passed projects, TP, invalid runs, precision, F1";
}
