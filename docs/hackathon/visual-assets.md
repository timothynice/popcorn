# Popcorn Hackathon Visual Assets

All diagrams use Mermaid syntax. Render via [mermaid.live](https://mermaid.live), GitHub markdown preview, or any Mermaid-compatible tool.

---

## 1. Architecture Overview Diagram

```mermaid
flowchart TB
    subgraph CC["Claude Code (Opus 4.6)"]
        AI["AI edits frontend file<br/>(Edit / Write tool)"]
    end

    subgraph Hook["Hook (Node.js)"]
        HR["PostToolUse Runner<br/>claude-hook-runner.ts"]
        PG["Plan Generator<br/>regex JSX/HTML detection"]
        PL["Plan Loader<br/>test-plans/*.json"]
        CL["Criteria Loader<br/>plain-text criteria"]
        BS["BridgeServer<br/>localhost:7890-7899"]
        EV["Acceptance Evaluator<br/>pattern-matched criteria"]
    end

    subgraph Ext["Chrome Extension (MV3)"]
        BC["Bridge Client<br/>chrome.alarms polling ~3s"]
        BG["Background SW<br/>state machine + orchestrator"]
        CS["Content Script<br/>14 action types, batched"]
        SC["Screenshot Capture<br/>captureVisibleTab"]
        TS["Tape Store<br/>IndexedDB"]
        PU["Popup UI<br/>React dashboard"]
    end

    subgraph Browser["Browser Tab"]
        DOM["Target Web App DOM"]
    end

    AI -->|"stdin JSON payload"| HR
    HR --> PL
    HR --> PG
    HR --> CL
    PL -->|"TestPlan"| BS
    PG -->|"auto-generated plan"| BS
    BS -->|"GET /poll<br/>X-Popcorn-Token"| BC
    BC --> BG
    BG -->|"navigate/wait<br/>chrome.tabs.update"| Browser
    BG -->|"execute_plan message"| CS
    CS -->|"click, fill, assert<br/>5+ actions/sec"| DOM
    CS -->|"capture_screenshot"| BG
    BG --> SC
    SC -->|"dataUrl"| CS
    CS -->|"StepResult[]"| BG
    BG -->|"DemoResult + screenshots"| BC
    BC -->|"POST /result"| BS
    BS -->|"DemoResult"| EV
    EV -->|"structured summary"| HR
    HR -->|"stdout to terminal"| CC
    BG --> TS
    TS --> PU

    style CC fill:#f0e6ff,stroke:#7c3aed,color:#000
    style Hook fill:#e6f7ff,stroke:#0284c7,color:#000
    style Ext fill:#e6ffe6,stroke:#16a34a,color:#000
    style Browser fill:#fff7e6,stroke:#d97706,color:#000
```

---

## 2. Data Flow Sequence Diagram

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant HR as Hook Runner
    participant BS as BridgeServer
    participant BG as Extension Background
    participant CS as Content Script
    participant Tab as Browser Tab

    CC->>HR: stdin: { tool_name: "Edit",<br/>tool_input: { file_path } }
    activate HR

    HR->>HR: loadConfig(), resolve watchDir
    HR->>HR: findMatchingPlan() or<br/>generatePlanFromFile()
    HR->>HR: loadCriteria()

    HR->>BS: ExtensionClient.connect()<br/>BridgeServer.start() on :7890-7899
    HR->>BS: enqueueMessage(start_demo)

    Note over BS,BG: chrome.alarms fires every ~3s

    BG->>BS: GET /poll<br/>X-Popcorn-Token: {token}
    BS-->>BG: { messages: [start_demo] }
    activate BG

    BG->>Tab: chrome.tabs.update(url)<br/>(navigate steps)
    Tab-->>BG: onUpdated: status=complete

    BG->>CS: chrome.scripting.executeScript<br/>(inject content.js)
    BG->>CS: sendMessage(execute_plan,<br/>{ steps: [...] })
    activate CS

    loop Each step (click, fill, assert...)
        CS->>Tab: querySelector + action
        Tab-->>CS: DOM result
    end

    CS->>BG: { type: capture_screenshot }
    BG->>BG: captureVisibleTab()
    BG-->>CS: { dataUrl: "data:image/png..." }

    CS-->>BG: { results: StepResult[] }
    deactivate CS

    BG->>BG: assembleDemoResult()
    BG->>BG: TapeStore.save()

    BG->>BS: POST /result<br/>{ message: demo_result }
    deactivate BG

    BS->>HR: resultCallback(DemoResult)

    HR->>HR: parsePlainTextCriteria()
    HR->>HR: evaluateAllCriteria()
    HR->>CC: stdout: structured summary<br/>(PASSED/FAILED + step details)
    deactivate HR
```

---

## 3. Acceptance Criteria Flow

```mermaid
flowchart TB
    Input["Plain-text criterion<br/><i>e.g. 'redirects to /dashboard'</i>"]
    Parse["parsePlainTextCriteria()"]
    Split["Split by newlines,<br/>trim + filter empty"]

    subgraph PM["Pattern Matching (priority order)"]
        P1["Duration<br/><code>/within|under \\d+ ms|s/</code>"]
        P2["URL Redirect<br/><code>/redirects? to \\S+/</code>"]
        P3["Error Display<br/><code>/shows? error/</code>"]
        P4["Form Submission<br/><code>/form submits? successfully/</code>"]
        P5["No Errors<br/><code>/no errors?/</code>"]
        P6["All Steps Pass<br/><code>/all steps? pass/</code>"]
        P7["Text Content<br/><code>/shows? 'text'/</code>"]
        FB["Fallback<br/>allStepsPassed()"]
    end

    subgraph EF["Evaluator Factory"]
        E1["completedWithinDuration(ms)"]
        E2["URL redirect checker<br/>scans metadata.finalUrl"]
        E3["Error assertion checker<br/>scans metadata.actualText"]
        E4["Form steps checker<br/>fill/select/check/click passed?"]
        E5["noStepErrors()"]
        E6["allStepsPassed()"]
        E7["Text content checker<br/>scans metadata.actualText"]
    end

    subgraph Eval["Evaluation at Runtime"]
        SR["StepResult[] with metadata<br/>(finalUrl, actualText, duration...)"]
        Run["criterion.evaluate(stepResults)"]
        CR["CriterionResult<br/>{ passed, message, evidence? }"]
    end

    Input --> Parse --> Split
    Split --> PM
    P1 -->|match| E1
    P2 -->|match| E2
    P3 -->|match| E3
    P4 -->|match| E4
    P5 -->|match| E5
    P6 -->|match| E6
    P7 -->|match| E7
    PM -->|no match| FB

    E1 & E2 & E3 & E4 & E5 & E6 & E7 --> Run
    FB --> Run
    SR --> Run
    Run --> CR

    style Input fill:#fef3c7,stroke:#d97706,color:#000
    style CR fill:#d1fae5,stroke:#16a34a,color:#000
    style PM fill:#ede9fe,stroke:#7c3aed,color:#000
    style EF fill:#e0f2fe,stroke:#0284c7,color:#000
    style Eval fill:#f0fdf4,stroke:#16a34a,color:#000
```

---

## 4. Auto-Generation Pipeline

```mermaid
flowchart TB
    subgraph Trigger["Trigger"]
        FC["File change detected<br/><code>LoginForm.tsx</code>"]
        NP["No matching test plan found<br/>in test-plans/"]
    end

    subgraph Detect["detectElements() - Regex Heuristics"]
        D1["<code>&lt;form&gt;</code> tags"]
        D2["<code>&lt;input&gt;</code> with name/id/type<br/>(skip hidden)"]
        D3["<code>&lt;textarea&gt;</code> elements"]
        D4["<code>&lt;select&gt;</code> dropdowns"]
        D5["<code>&lt;button&gt;</code> elements<br/>(submit detection)"]
        D6["<code>&lt;a href&gt;</code> links<br/>(skip # and javascript:)"]
    end

    subgraph Build["buildSteps() - Step Sequencing"]
        S1["1. navigate to baseUrl"]
        S2["2. wait for page load"]
        S3["3. fill email input<br/><code>#email</code> &rarr; 'test@example.com'"]
        S4["4. fill password input<br/><code>#password</code> &rarr; 'TestPass123!'"]
        S5["5. click submit button<br/><code>button[type=submit]</code>"]
        S6["6. screenshot<br/>capture final state"]
    end

    subgraph Output["Output"]
        TP["TestPlan JSON"]
        Save["savePlan()<br/><code>test-plans/login-form.json</code>"]
        Tags["tags: ['auto-generated']"]
    end

    subgraph Fallback["No Interactive Elements?"]
        VC["Visual-check plan"]
        IG["Import graph analysis<br/>(keyboard nav, route detection)"]
        SS["Navigate + wait + screenshot"]
    end

    FC --> NP --> Detect
    D1 & D2 & D3 & D4 & D5 & D6 --> Build
    S1 --> S2 --> S3 --> S4 --> S5 --> S6
    Build --> TP --> Save
    TP --- Tags

    NP -->|"elements.length === 0"| Fallback
    VC --> IG --> SS

    style Trigger fill:#fef3c7,stroke:#d97706,color:#000
    style Detect fill:#ede9fe,stroke:#7c3aed,color:#000
    style Build fill:#e0f2fe,stroke:#0284c7,color:#000
    style Output fill:#d1fae5,stroke:#16a34a,color:#000
    style Fallback fill:#fee2e2,stroke:#dc2626,color:#000
```

---

## 5. GitHub Badges

Copy-paste these into your README or submission page:

```markdown
![Tests](https://img.shields.io/badge/tests-387_passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-private-lightgrey)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-ES_Modules-339933?logo=nodedotjs&logoColor=white)
![Zero Cloud](https://img.shields.io/badge/cloud_deps-zero-orange)
![Claude Code](https://img.shields.io/badge/Claude_Code-PostToolUse_Hook-7c3aed)
```

**Rendered preview:**

![Tests](https://img.shields.io/badge/tests-387_passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-private-lightgrey)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-ES_Modules-339933?logo=nodedotjs&logoColor=white)
![Zero Cloud](https://img.shields.io/badge/cloud_deps-zero-orange)
![Claude Code](https://img.shields.io/badge/Claude_Code-PostToolUse_Hook-7c3aed)

---

## 6. Screenshot Capture List

These are the key screenshots to capture for the hackathon submission. Each entry includes what to show and how to set it up.

### 6.1 Extension Popup - Tape List

**What:** The popup showing a list of completed demo tapes with pass/fail status badges and thumbnails.

**Setup:**
1. Run several demos (both passing and failing) so the tape list has variety
2. Click the Popcorn extension icon to open the popup
3. The main view shows tape cards with green checkmarks or red X badges
4. Make sure the StatusBar at the bottom shows the green dot (hook connected)

**Key elements to highlight:** Pass/fail badges, tape names, duration, hook connection indicator

### 6.2 Extension Popup - Tape Detail with Screenshots

**What:** A single tape expanded to show the step-by-step results with captured screenshots inline.

**Setup:**
1. Click on a tape card that has screenshots (any demo with screenshot steps)
2. The detail view shows each step with [OK]/[FAIL] indicators
3. Screenshots appear inline next to their corresponding steps
4. If the tape has a test plan stored, the "Re-run with Video Recording" button is visible

**Key elements to highlight:** Step results with metadata, inline screenshots, re-run button

### 6.3 Terminal - Popcorn Hook Output

**What:** The structured summary printed by the hook after a demo completes.

**Setup:**
1. Have Claude Code edit a frontend file in a project with Popcorn configured
2. The hook fires automatically and prints to the Claude Code terminal
3. Capture the output showing:
   - `[Popcorn] File changed: src/components/LoginForm.tsx`
   - `[Popcorn] Dispatching test plan 'login-form'`
   - `--- Popcorn Demo Result ---`
   - Step-by-step [OK]/[FAIL] results with durations
   - Criteria evaluation results
   - `---------------------------`

**Key elements to highlight:** The structured format that Claude reads to decide next steps

### 6.4 Terminal - `popcorn init` Output

**What:** The CLI scaffolding a new project in one command.

**Setup:**
1. Create or use a sample project with some React/Vue/HTML files
2. Run `popcorn init` from the project root
3. Capture the output showing:
   - Watch directory auto-detection
   - Source file scanning results
   - Generated test plans for detected interactive elements
   - Created files: `popcorn.config.json`, `test-plans/`, `.claude/settings.local.json`
   - Hook runner path resolution

**Key elements to highlight:** Zero-config setup, auto-detection, instant plan generation

### 6.5 Claude Code Session - Full Loop in Action

**What:** A Claude Code conversation where the AI edits a file, Popcorn runs automatically, and the AI reads the results.

**Setup:**
1. Start a Claude Code session in a Popcorn-configured project
2. Ask Claude to modify a UI component (e.g., "add email validation to the login form")
3. After the Edit tool completes, the PostToolUse hook fires
4. Capture the sequence:
   - Claude's edit appearing in the conversation
   - The `[Popcorn]` output appearing in the terminal
   - Claude reading the results and either iterating or confirming success

**Key elements to highlight:** The autonomous feedback loop - edit, test, read results, iterate

### 6.6 Architecture Comparison (Optional)

**What:** A before/after showing the traditional manual testing workflow vs. the Popcorn automated loop.

**Before:** Developer edits code -> switches to browser -> manually refreshes -> visually inspects -> switches back to editor -> reports to AI

**After:** AI edits code -> Popcorn automatically demos in browser -> AI reads structured results -> AI iterates or moves on

This can be a simple two-panel diagram or screenshot composite.
