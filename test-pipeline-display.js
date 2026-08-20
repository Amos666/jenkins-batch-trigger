/**
 * Test: Verify Pipeline column display level cycling logic
 */

// Simulate the display level logic
let pipelineDisplayLevel = 0;

function getPipelineDisplayLabel(d) {
  if (pipelineDisplayLevel === 0) {
    return d.name;
  }
  // Extract path segments from jobPath or folder
  const fullPath = d.jobPath || d.name;
  const parts = fullPath.split("/");
  if (parts.length === 1) {
    return d.name; // No parent info available
  }
  if (pipelineDisplayLevel === 1) {
    // Show immediate parent + job name
    return parts.length >= 2 ? parts.slice(-2).join("/") : d.name;
  }
  // Level 2: show up to 2 ancestors + job name
  return parts.length >= 3 ? parts.slice(-3).join("/") : fullPath;
}

// Test data
const testJobs = [
  { id: "1", name: "deploy", jobPath: "order-service/deploy" },
  { id: "2", name: "unit-test", jobPath: "order-service/unit-test" },
  { id: "3", name: "build", jobPath: "team-a/order-service/build" },
  { id: "4", name: "simple-job", jobPath: "simple-job" },
];

console.log("=== Pipeline Display Level Test ===\n");

// Test level 0: job name only
pipelineDisplayLevel = 0;
console.log("Level 0 (job name only):");
testJobs.forEach(j => {
  console.log(`  ${j.jobPath} → "${getPipelineDisplayLabel(j)}"`);
});

// Test level 1: parent/job
pipelineDisplayLevel = 1;
console.log("\nLevel 1 (parent/job):");
testJobs.forEach(j => {
  console.log(`  ${j.jobPath} → "${getPipelineDisplayLabel(j)}"`);
});

// Test level 2: grandparent/parent/job
pipelineDisplayLevel = 2;
console.log("\nLevel 2 (grandparent/parent/job):");
testJobs.forEach(j => {
  console.log(`  ${j.jobPath} → "${getPipelineDisplayLabel(j)}"`);
});

// Test cycling
console.log("\n=== Cycling Test ===");
pipelineDisplayLevel = 0;
console.log(`Initial: level ${pipelineDisplayLevel}`);
pipelineDisplayLevel = (pipelineDisplayLevel + 1) % 3;
console.log(`After 1st dblclick: level ${pipelineDisplayLevel}`);
pipelineDisplayLevel = (pipelineDisplayLevel + 1) % 3;
console.log(`After 2nd dblclick: level ${pipelineDisplayLevel}`);
pipelineDisplayLevel = (pipelineDisplayLevel + 1) % 3;
console.log(`After 3rd dblclick: level ${pipelineDisplayLevel} (back to 0)`);

// Verification
console.log("\n=== Verification ===");
let allPassed = true;

// Level 0 tests
pipelineDisplayLevel = 0;
if (getPipelineDisplayLabel(testJobs[0]) === "deploy") {
  console.log("✓ Level 0: job name only works");
} else {
  console.log("✗ Level 0: job name only failed");
  allPassed = false;
}

// Level 1 tests
pipelineDisplayLevel = 1;
if (getPipelineDisplayLabel(testJobs[0]) === "order-service/deploy") {
  console.log("✓ Level 1: parent/job works");
} else {
  console.log(`✗ Level 1: parent/job failed, got "${getPipelineDisplayLabel(testJobs[0])}"`);
  allPassed = false;
}

// Level 2 tests
pipelineDisplayLevel = 2;
if (getPipelineDisplayLabel(testJobs[2]) === "team-a/order-service/build") {
  console.log("✓ Level 2: grandparent/parent/job works");
} else {
  console.log(`✗ Level 2: grandparent/parent/job failed, got "${getPipelineDisplayLabel(testJobs[2])}"`);
  allPassed = false;
}

// Edge case: single segment path
pipelineDisplayLevel = 2;
if (getPipelineDisplayLabel(testJobs[3]) === "simple-job") {
  console.log("✓ Edge case: single segment path handled correctly");
} else {
  console.log(`✗ Edge case: single segment path failed, got "${getPipelineDisplayLabel(testJobs[3])}"`);
  allPassed = false;
}

console.log("\n=== Result ===");
if (allPassed) {
  console.log("✓ All tests PASSED");
  process.exit(0);
} else {
  console.log("✗ Some tests FAILED");
  process.exit(1);
}
