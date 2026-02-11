# **Popcorn Chrome Extension and Claude Code Hook – Product Requirements Document (PRD)**

## **Introduction**

Popcorn is a development tool for autonomous UI testing. It combines a Chrome extension and a Claude Code hook. Whenever the AI makes changes to your UI code, Popcorn automatically runs a visual demo, captures a video replay and presents a summary of what was tested. The aim is to deliver confidence in AI‑generated code by allowing developers to watch the AI test its work.

## **Problem Statement**

Developers increasingly rely on AI agents to modify user interfaces. Manual verification is slow and tedious. They often have to wait while an AI clicks through pages one element at a time, trust that the changes are correct without visual confirmation or lose track of what changed across iterations. Popcorn addresses these pains by ensuring the AI tests its own changes quickly and records the results for later review.

## **Solution / Feature Overview**

Popcorn monitors your project for UI‑oriented changes and triggers automated demos:

* **Chrome extension** that injects a testing harness into the browser. It reads a batch of browser operations precomputed by the AI and executes them rapidly.

* **Claude Code hook** that fires when frontend files are modified. It signals the Chrome extension to start a demo and passes acceptance criteria.

* **Batched browser operations** to reduce latency. The AI plans a sequence of interactions up front and sends it to the extension in a single payload. The extension executes them quickly and sends results back in bulk.

* **Video replay and reports**. Each demo produces a recording and a structured bug report. Replays can be viewed later with timestamps, step markers and notes describing misalignments or unexpected behaviour.

* **User‑defined acceptance criteria**. Developers can supply custom checklists for different flows or choose from presets (forms, navigation, authentication). The AI uses these criteria to decide pass/fail and to surface deviations proactively.

## **User Stories**

* **As a developer**, I want Popcorn to trigger automatically when frontend files in my project change so that I do not need to remember to run tests manually.

* **As a developer**, I want the extension to execute UI tests faster than human interaction, so that I can iterate quickly.

* **As a product manager**, I want to see a video replay of each AI‑generated change along with a list of files modified and a summary of what was tested, so that I can trust the output without re‑running the demo.

* **As a QA engineer**, I want to provide plain‑English acceptance criteria or select presets so that the AI can evaluate its own work against my standards.

* **As a team lead**, I want recordings saved locally for privacy, with no external uploads, so that the tool is safe to use on proprietary UIs.

## **Technical Requirements**

* Implement a Chrome extension using Manifest V3. The extension injects a content script into active tabs and a background script to manage state. It subscribes to messages from the Claude Code hook.

* Implement a Claude Code hook that watches the project’s src/frontend directory for changes. When files are saved, it packages acceptance criteria and sends a start\_demo message to the extension.

* Accept any change to files with extensions .js, .ts, .jsx or .tsx in the watched directory as a UI‑oriented change for v1. To mark other files, developers can add a // popcorn-test comment.

* Use a batched test plan format. The AI generates a list of browser operations (click selectors, fill inputs, navigate URLs, take screenshots) and sends them to the extension in a single payload. The extension executes the operations rapidly, saving intermediate screenshots in memory and returning them in bulk.

* Capture video replays using the Chrome extension’s tab capture API. Store recordings locally (IndexedDB or the user’s file system via the File System Access API). Provide a lightweight UI to view past runs, with thumbnails, timestamps and inline annotations.

* Define acceptance criteria as plain text checklists or presets stored in JSON. The AI reads these criteria and determines whether each step passes.

* Summarise results. The extension returns structured results to Claude Code: which steps passed/failed, key screenshots and a short textual summary. The AI uses this to update the console and refine its plan.

* Build the project with Node.js and TypeScript. Provide scripts for building (npm run build), running the extension in dev mode (npm run start), running unit tests (npm test) and generating documentation (npm run docs).

* Support asynchronous, event‑driven communication between the hook and the extension via the chrome.runtime messaging API. Provide a clear interface for future expansion (e.g., multi‑tab demos).

## **Acceptance Criteria**

* When a file in src/frontend is saved, the Claude Code hook triggers a Popcorn demo automatically.

* The extension receives a batched test plan and executes all operations without human interaction at a speed faster than manual clicking (target: complete 5 actions per second or faster).

* The system produces a video replay of every demo and stores it locally. Each recording is accessible from a “tapes” dashboard showing a timestamp, files changed, a summary and a thumbnail.

* Developers can supply acceptance criteria via a plain‑text editor in the extension or choose a preset. The extension uses these criteria to evaluate the test and returns structured results to Claude Code.

* The system reports failures (e.g., misaligned elements, modals that don’t open) in a structured summary and highlights them in the recording timeline.

* Privacy is respected: no recordings or data are uploaded to external services.

## **Constraints and Considerations**

* **Trigger definition**: For v1, the hook triggers on any change in src/frontend after the developer reloads the page. Future versions can detect changes when code is written or compiled.

* **UI change detection**: Automatic detection of “visual changes” is out of scope for v1. Treat any change to watched files or code marked with // popcorn-test as requiring a demo.

* **Batched operations**: Precomputed workflows might miss edge cases and timing issues. Position this feature as fast visual confidence rather than full test coverage.

* **Video storage**: Recordings are stored locally only, either in IndexedDB or the file system. Cloud storage is explicitly out of scope for v1 to avoid privacy concerns.

* **Framework assumptions**: The project uses Node.js and TypeScript. Assumed frameworks include React for UI components and Chrome Extension APIs for integration. Adjust as needed if a different stack is chosen.

* **AI assumptions**: Claude Opus 4.6 and its agents will handle planning, implementation, testing and summarising autonomously. Subagents and agent teams may be used to parallelise tasks.

