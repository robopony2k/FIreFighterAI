#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WORK_QUEUE_PATH = resolve(process.cwd(), "work_queue.md");
const VALID_STATUSES = new Set(["queued", "in-progress", "blocked", "done"]);
const STATUS_RANK = {
  "in-progress": 0,
  queued: 1,
  blocked: 2,
  done: 3,
};
const TYPE_RANK = {
  bug: 0,
  refactor: 1,
  feature: 2,
  "tech-debt": 3,
  polish: 4,
};
const FIELD_LABELS = ["Type", "Why", "Done when", "Touchpoints", "Constraints", "Notes", "Status"];

const command = process.argv[2] ?? "help";

function readQueueFile() {
  return readFileSync(WORK_QUEUE_PATH, "utf8").replace(/\r\n/g, "\n");
}

function parseQueue(text) {
  const lines = text.split("\n");
  const entries = [];
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(/^(TSK-[A-Za-z0-9-]+):\s*(.+?)\s*$/);
    if (headerMatch) {
      if (current) {
        entries.push(finalizeEntry(current, entries.length));
      }
      current = {
        id: headerMatch[1],
        title: headerMatch[2],
        lines: [],
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    entries.push(finalizeEntry(current, entries.length));
  }

  return entries;
}

function finalizeEntry(entry, index) {
  const text = entry.lines.join("\n");
  const type = getFieldValue(text, "Type")?.toLowerCase() ?? "";
  const status = getFieldValue(text, "Status")?.toLowerCase() ?? "";
  return {
    id: entry.id,
    title: entry.title,
    type,
    why: getFieldValue(text, "Why") ?? "",
    touchpoints: getFieldValue(text, "Touchpoints") ?? "",
    constraints: getFieldValue(text, "Constraints") ?? "",
    notes: getFieldValue(text, "Notes") ?? "",
    status,
    doneWhen: getDoneWhen(entry.lines),
    fileOrder: index,
    raw: text,
  };
}

function getFieldValue(text, label) {
  const pattern = new RegExp(`(?:^|\\n)\\*{0,2}${escapeRegex(label)}\\*{0,2}:\\s*(.*)`, "i");
  const match = text.match(pattern);
  return match ? normalizeLine(match[1]) : null;
}

function getDoneWhen(lines) {
  const doneWhenIndex = lines.findIndex((line) => /^\*{0,2}Done when\*{0,2}:\s*$/i.test(line.trim()));
  if (doneWhenIndex === -1) {
    return [];
  }

  const items = [];
  for (let index = doneWhenIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (isFieldHeader(line)) {
      break;
    }
    const normalized = normalizeChecklistLine(line);
    if (normalized) {
      items.push(normalized);
    }
  }
  return items;
}

function isFieldHeader(line) {
  const trimmed = line.trim();
  return FIELD_LABELS.some((label) => new RegExp(`^\\*{0,2}${escapeRegex(label)}\\*{0,2}:`, "i").test(trimmed));
}

function normalizeChecklistLine(line) {
  return normalizeLine(
    line
      .replace(/&nbsp;/gi, " ")
      .replace(/^\s*[-*]\s*\[[ xX]\]\s*/, "")
      .replace(/^\s*[-*]\s*/, "")
  );
}

function normalizeLine(line) {
  return line.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftStatus = STATUS_RANK[left.status] ?? 99;
    const rightStatus = STATUS_RANK[right.status] ?? 99;
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }

    const leftType = TYPE_RANK[left.type] ?? 99;
    const rightType = TYPE_RANK[right.type] ?? 99;
    if (leftType !== rightType) {
      return leftType - rightType;
    }

    return left.fileOrder - right.fileOrder;
  });
}

function summarize(entries) {
  const counts = {
    total: entries.length,
    queued: 0,
    "in-progress": 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  };

  for (const entry of entries) {
    if (entry.status in counts) {
      counts[entry.status] += 1;
    } else {
      counts.unknown += 1;
    }
  }

  return counts;
}

function formatEntry(entry, index) {
  const lines = [];
  lines.push(`${index + 1}. ${entry.id}: ${entry.title} [${entry.status || "unknown"}${entry.type ? ` / ${entry.type}` : ""}]`);
  if (entry.why) {
    lines.push(`   Why: ${entry.why}`);
  }
  if (entry.touchpoints) {
    lines.push(`   Touchpoints: ${entry.touchpoints}`);
  }
  if (entry.doneWhen.length > 0) {
    lines.push(`   Done when: ${entry.doneWhen.join("; ")}`);
  }
  return lines.join("\n");
}

function printHelp() {
  console.log("Usage: node skills/game-design-maintainer/scripts/work_queue_cli.mjs <command>");
  console.log("");
  console.log("Commands:");
  console.log("  next      Show the recommended next tasks from work_queue.md");
  console.log("  summary   Show queue counts by status");
  console.log("  validate  Validate queue IDs, statuses, and required fields");
  console.log("  json      Print the parsed queue as JSON");
}

function runNext(entries) {
  const active = sortEntries(entries).filter((entry) => entry.status !== "done");
  const recommended = active.slice(0, 3);

  if (recommended.length === 0) {
    console.log("No queued, blocked, or in-progress work was found in work_queue.md.");
    return 0;
  }

  console.log("Recommended next work:");
  for (const [index, entry] of recommended.entries()) {
    console.log(formatEntry(entry, index));
  }
  return 0;
}

function runSummary(entries) {
  const counts = summarize(entries);
  console.log(`Total: ${counts.total}`);
  console.log(`In progress: ${counts["in-progress"]}`);
  console.log(`Queued: ${counts.queued}`);
  console.log(`Blocked: ${counts.blocked}`);
  console.log(`Done: ${counts.done}`);
  if (counts.unknown > 0) {
    console.log(`Unknown: ${counts.unknown}`);
  }
  return counts.unknown > 0 ? 1 : 0;
}

function runValidate(entries) {
  const errors = [];
  const seenIds = new Set();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      errors.push(`Duplicate task id: ${entry.id}`);
    }
    seenIds.add(entry.id);

    if (!entry.title) {
      errors.push(`Missing title for ${entry.id}`);
    }
    if (!entry.type) {
      errors.push(`Missing type for ${entry.id}`);
    }
    if (!entry.status) {
      errors.push(`Missing status for ${entry.id}`);
    } else if (!VALID_STATUSES.has(entry.status)) {
      errors.push(`Invalid status for ${entry.id}: ${entry.status}`);
    }
  }

  if (errors.length > 0) {
    console.error("Queue validation failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    return 1;
  }

  const counts = summarize(entries);
  console.log(`Queue validation passed for ${counts.total} task(s).`);
  console.log(`Statuses: in-progress=${counts["in-progress"]}, queued=${counts.queued}, blocked=${counts.blocked}, done=${counts.done}`);
  return 0;
}

function runJson(entries) {
  console.log(JSON.stringify({ summary: summarize(entries), entries: sortEntries(entries) }, null, 2));
  return 0;
}

let exitCode = 0;

try {
  const entries = parseQueue(readQueueFile());

  switch (command) {
    case "next":
      exitCode = runNext(entries);
      break;
    case "summary":
      exitCode = runSummary(entries);
      break;
    case "validate":
      exitCode = runValidate(entries);
      break;
    case "json":
      exitCode = runJson(entries);
      break;
    default:
      printHelp();
      exitCode = command === "help" ? 0 : 1;
      break;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
}

process.exit(exitCode);
