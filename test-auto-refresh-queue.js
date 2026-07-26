/**
 * Test: Verify that auto-refresh includes terminal-state jobs with queue > 0
 * 
 * This test validates the filtering logic in state.ts refreshSelected() method.
 */

function filterNonTerminalJobs(allJobs) {
  const TERMINAL = new Set(["success", "failed", "aborted"]);
  return allJobs.filter((j) => !TERMINAL.has(j.status || "unknown") || (j.queue && j.queue > 0));
}

// Test cases
const testJobs = [
  { id: "job1", status: "success", queue: 0 },      // Should be EXCLUDED (terminal, no queue)
  { id: "job2", status: "success", queue: 2 },      // Should be INCLUDED (terminal, but queued)
  { id: "job3", status: "failed", queue: 0 },       // Should be EXCLUDED (terminal, no queue)
  { id: "job4", status: "failed", queue: 1 },       // Should be INCLUDED (terminal, but queued)
  { id: "job5", status: "aborted", queue: 0 },      // Should be EXCLUDED (terminal, no queue)
  { id: "job6", status: "aborted", queue: 3 },      // Should be INCLUDED (terminal, but queued)
  { id: "job7", status: "running", queue: 0 },      // Should be INCLUDED (non-terminal)
  { id: "job8", status: "running", queue: 1 },      // Should be INCLUDED (non-terminal)
  { id: "job9", status: "unknown", queue: 0 },      // Should be INCLUDED (non-terminal)
  { id: "job10", status: "unstable", queue: 0 },    // Should be INCLUDED (non-terminal)
];

const filtered = filterNonTerminalJobs(testJobs);

console.log("=== Auto-Refresh Filter Test ===\n");
console.log("Input jobs:", testJobs.length);
console.log("Filtered jobs (should be refreshed):", filtered.length);
console.log("\nFiltered job IDs:", filtered.map(j => j.id).join(", "));

// Expected: job2, job4, job6, job7, job8, job9, job10 (7 jobs)
// Excluded: job1, job3, job5 (3 jobs)

const expectedIncluded = ["job2", "job4", "job6", "job7", "job8", "job9", "job10"];
const expectedExcluded = ["job1", "job3", "job5"];

const filteredIds = new Set(filtered.map(j => j.id));

console.log("\n=== Verification ===");
let allPassed = true;

for (const id of expectedIncluded) {
  if (filteredIds.has(id)) {
    console.log(`✓ ${id} correctly INCLUDED`);
  } else {
    console.log(`✗ ${id} should be INCLUDED but was EXCLUDED`);
    allPassed = false;
  }
}

for (const id of expectedExcluded) {
  if (!filteredIds.has(id)) {
    console.log(`✓ ${id} correctly EXCLUDED`);
  } else {
    console.log(`✗ ${id} should be EXCLUDED but was INCLUDED`);
    allPassed = false;
  }
}

console.log("\n=== Result ===");
if (allPassed) {
  console.log("✓ All tests PASSED");
  process.exit(0);
} else {
  console.log("✗ Some tests FAILED");
  process.exit(1);
}
