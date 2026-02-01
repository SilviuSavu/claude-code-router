// Test suite for multi-turn contradiction tracking (Tier 2.1)
const { ConversationContradictionDetector } = require('../plugins/glm47-transformer/conversation-contradiction-detector.js');

// ANSI color codes
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function testGroup(name, fn) {
  console.log(`\n${YELLOW}▶ ${name}${RESET}`);
  try {
    fn();
    console.log(`  ${GREEN}✓ Passed${RESET}`);
  } catch (error) {
    console.log(`  ${RED}✗ Failed: ${error.message}${RESET}`);
    throw error;
  }
}

// Test 1: Temporal Contradictions
testGroup('Temporal Contradictions', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  const convId = 'test-conv-1';

  // Turn 1: "React was released in 2013"
  const turn1 = "React was released in 2013 and has been popular ever since.";
  const result1 = detector.analyze(convId, turn1, 1);
  assert(!result1.detected, 'First turn should not detect contradictions');

  // Turn 2: "React was released in 2015" - CONTRADICTION
  const turn2 = "Actually, React was released in 2015, not earlier.";
  const result2 = detector.analyze(convId, turn2, 2);

  assert(result2.detected, 'Should detect release year contradiction');
  assert(result2.count > 0, 'Should have at least one contradiction');
  assert(result2.contradictions[0].entity.includes('react'), 'Entity should be React');
  assert(result2.severity !== 'NONE', 'Should have non-zero severity');
});

// Test 2: Availability Contradictions
testGroup('Availability Contradictions', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  const convId = 'test-conv-2';

  // Turn 1: "Feature X is available"
  const turn1 = "The new feature is now available in version 2.0.";
  detector.analyze(convId, turn1, 1);

  // Turn 2: "Feature X is not yet available" - CONTRADICTION
  const turn2 = "The new feature is not yet available, it's still in development.";
  const result2 = detector.analyze(convId, turn2, 2);

  assert(result2.detected, 'Should detect availability contradiction');
  assert(result2.count > 0, 'Should have contradictions');
});

// Test 3: Support Contradictions
testGroup('Support Contradictions', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  const convId = 'test-conv-3';

  // Turn 1: "TypeScript supports decorators"
  const turn1 = "TypeScript supports decorators for classes and methods.";
  detector.analyze(convId, turn1, 1);

  // Turn 2: "TypeScript doesn't support decorators" - CONTRADICTION
  const turn2 = "TypeScript doesn't support decorators natively without experimental flags.";
  const result2 = detector.analyze(convId, turn2, 2);

  assert(result2.detected, 'Should detect support contradiction');
  assert(result2.contradictions[0].type === 'support' || result2.contradictions[0].type === 'support_neg',
    'Should identify support/support_neg types');
});

// Test 4: Version Number Contradictions
testGroup('Version Number Contradictions', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  const convId = 'test-conv-4';

  // Turn 1: "Node.js version 18.0"
  const turn1 = "The current Node.js version 18.0 has many improvements.";
  detector.analyze(convId, turn1, 1);

  // Turn 2: "Node.js version 20.0" - CONTRADICTION
  const turn2 = "Node.js version 20.0 is the latest stable release.";
  const result2 = detector.analyze(convId, turn2, 2);

  assert(result2.detected, 'Should detect version contradiction');
  assert(result2.contradictions[0].category === 'numerical', 'Should be numerical category');
});

// Test 5: Location Contradictions
testGroup('Location Contradictions', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  const convId = 'test-conv-5';

  // Turn 1: "Company is located in San Francisco"
  const turn1 = "The startup is located in San Francisco, California.";
  detector.analyze(convId, turn1, 1);

  // Turn 2: "Company is located in New York" - CONTRADICTION
  const turn2 = "The startup is located in New York City.";
  const result2 = detector.analyze(convId, turn2, 2);

  assert(result2.detected, 'Should detect location contradiction');
  assert(result2.contradictions[0].category === 'location', 'Should be location category');
});

// Test 6: Entity Matching
testGroup('Entity Matching (Fuzzy)', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  // Test exact match
  assert(detector.entitiesMatch('react', 'react'), 'Should match exact');

  // Test fuzzy match (contains)
  assert(detector.entitiesMatch('react.js', 'react'), 'Should match react.js and react');
  assert(detector.entitiesMatch('react', 'react.js'), 'Should match react and react.js');

  // Test normalized match (punctuation removed)
  assert(detector.entitiesMatch('next-js', 'nextjs'), 'Should match next-js and nextjs');
  assert(detector.entitiesMatch('vue.js', 'vuejs'), 'Should match vue.js and vuejs');

  // Test non-match
  assert(!detector.entitiesMatch('react', 'angular'), 'Should not match different entities');
});

// Test 7: Recency Factor
testGroup('Recency Factor', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  // Recent (within 5 minutes)
  const recent = Date.now();
  assert(detector.calculateRecencyFactor(recent) === 1.0, 'Recent should be 1.0');

  // Medium age (10 minutes ago)
  const mediumAge = Date.now() - (10 * 60 * 1000);
  assert(detector.calculateRecencyFactor(mediumAge) === 0.8, 'Medium age should be 0.8');

  // Old (1 hour ago)
  const old = Date.now() - (60 * 60 * 1000);
  assert(detector.calculateRecencyFactor(old) === 0.5, 'Old should be 0.5');
});

// Test 8: Severity Levels
testGroup('Severity Levels', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  assert(detector.getSeverityLevel(0) === 'NONE', 'Score 0 should be NONE');
  assert(detector.getSeverityLevel(1) === 'LOW', 'Score 1 should be LOW');
  assert(detector.getSeverityLevel(2.5) === 'MEDIUM', 'Score 2.5 should be MEDIUM');
  assert(detector.getSeverityLevel(5) === 'HIGH', 'Score 5 should be HIGH');
  assert(detector.getSeverityLevel(7) === 'CRITICAL', 'Score 7 should be CRITICAL');
});

// Test 9: Intervention Threshold
testGroup('Intervention Threshold', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 4  // Require HIGH severity
  });

  const convId = 'test-conv-9';

  // Turn 1: Make a statement
  const turn1 = "Python was released in 1991.";
  detector.analyze(convId, turn1, 1);

  // Turn 2: Contradict with low severity
  const turn2 = "Python was released in 1990.";  // Weight 2, recency 1.0 = score 2 (LOW)
  const result2 = detector.analyze(convId, turn2, 2);

  // Should detect but not intervene (score < threshold)
  assert(result2.detected, 'Should detect contradiction');
  assert(!result2.shouldIntervene, 'Should NOT intervene (score below threshold)');

  // Turn 3: Multiple contradictions to reach threshold
  const turn3 = "Actually, Node.js was released in 2005 and Python was released in 1989.";
  const result3 = detector.analyze(convId, turn3, 3);

  // Should now intervene (multiple contradictions)
  if (result3.detected && result3.score >= 4) {
    assert(result3.shouldIntervene, 'Should intervene when threshold reached');
  }
});

// Test 10: History Pruning
testGroup('History Pruning', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    maxHistoryItems: 5  // Small limit for testing
  });

  const convId = 'test-conv-10';

  // Add 10 assertions (should prune to 5)
  for (let i = 0; i < 10; i++) {
    const text = `React version ${i}.0 is released.`;
    detector.analyze(convId, text, i);
  }

  const stats = detector.getStats();
  assert(stats.totalAssertions <= 5, `Should prune to max 5 assertions, got ${stats.totalAssertions}`);
});

// Test 11: No Self-Contradiction
testGroup('No Self-Contradiction (Same Turn)', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true,
    severityThreshold: 2
  });

  const convId = 'test-conv-11';

  // Single turn with multiple assertions (shouldn't contradict itself)
  const turn1 = "React was released in 2013 and Vue was released in 2014.";
  const result1 = detector.analyze(convId, turn1, 1);

  assert(!result1.detected, 'Same turn should not contradict itself');
});

// Test 12: Stats and Cleanup
testGroup('Stats and Cleanup', () => {
  const detector = new ConversationContradictionDetector({
    enabled: true
  });

  const convId1 = 'test-conv-12a';
  const convId2 = 'test-conv-12b';

  // Add data to multiple conversations
  detector.analyze(convId1, "React was released in 2013.", 1);
  detector.analyze(convId2, "Vue was released in 2014.", 1);

  let stats = detector.getStats();
  assert(stats.conversationCount === 2, 'Should track 2 conversations');
  assert(stats.totalAssertions > 0, 'Should have assertions');

  // Clear specific conversation
  detector.clearConversation(convId1);
  stats = detector.getStats();
  assert(stats.conversationCount === 1, 'Should have 1 conversation after clear');

  // Clear all
  detector.clear();
  stats = detector.getStats();
  assert(stats.conversationCount === 0, 'Should have 0 conversations after clear all');
  assert(stats.totalAssertions === 0, 'Should have 0 assertions after clear all');
});

console.log(`\n${GREEN}✓ All contradiction tracking tests passed!${RESET}\n`);
