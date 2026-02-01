// Test suite for premature conclusion detection (Tier 2.2)
const { HallucinationDetector } = require('../plugins/glm47-transformer/hallucination-detector.js');

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

// Test 1: Premature Conclusion Patterns
testGroup('Premature Conclusion Patterns', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  // Test "therefore the answer" pattern
  const text1 = "Therefore the answer is 42.";
  const result1 = detector.analyze(text1);
  assert(result1.patterns.includes('prematureConclusion'), 'Should detect "therefore the answer"');

  // Test "quickly the answer" pattern
  const text2 = "Quickly the answer becomes clear.";
  const result2 = detector.analyze(text2);
  assert(result2.patterns.includes('prematureConclusion'), 'Should detect "quickly the answer"');

  // Test "without thinking further" pattern
  const text3 = "Without thinking further, we can conclude...";
  const result3 = detector.analyze(text3);
  assert(result3.patterns.includes('prematureConclusion'), 'Should detect "without thinking further"');

  // Test "immediately clear" pattern
  const text4 = "It's immediately clear that this is the solution.";
  const result4 = detector.analyze(text4);
  assert(result4.patterns.includes('prematureConclusion'), 'Should detect "immediately clear"');

  // Test "jumping to conclusion" pattern
  const text5 = "I'm jumping to the conclusion here.";
  const result5 = detector.analyze(text5);
  assert(result5.patterns.includes('prematureConclusion'), 'Should detect "jumping to conclusion"');
});

// Test 2: Thinking Length Analysis - Factual Query
testGroup('Thinking Length - Factual Query', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const factualMessages = [{
    role: 'user',
    content: 'What is the capital of France?'
  }];

  // Short thinking for factual query (OK)
  const shortText = "Paris is the capital of France.";  // ~6 words
  const result1 = detector.analyze(shortText, '', factualMessages);
  // Factual queries only need 30 words minimum, 6 is too short
  assert(result1.thinkingTooShort === true, 'Short thinking should be flagged for factual query');

  // Adequate thinking for factual query (needs 30+ words)
  const adequateText = "The capital of France is Paris. Paris has been the capital city since the 12th century and is located in the north-central part of the country on the Seine river. It is also the largest city in France.";  // ~35+ words
  const result2 = detector.analyze(adequateText, '', factualMessages);
  assert(result2.thinkingTooShort === false, `Adequate thinking (${result2.thinkingLength} words) should not be flagged (min: 30)`);
});

// Test 3: Thinking Length Analysis - Reasoning Query
testGroup('Thinking Length - Reasoning Query', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const reasoningMessages = [{
    role: 'user',
    content: 'How does React\'s virtual DOM improve performance?'
  }];

  // Short thinking for reasoning query (NOT OK)
  const shortText = "It's faster.";  // ~2 words
  const result1 = detector.analyze(shortText, '', reasoningMessages);
  assert(result1.thinkingTooShort === true, 'Short thinking should be flagged for reasoning query');
  assert(result1.patterns.includes('insufficientThinking'), 'Should detect insufficient thinking');

  // Adequate thinking for reasoning query (80+ words)
  const adequateText = `
    React's virtual DOM improves performance through a diffing algorithm.
    When state changes, React creates a new virtual DOM tree and compares it
    with the previous one. It calculates the minimal set of changes needed
    to update the real DOM. This is more efficient than directly manipulating
    the DOM for every change, because DOM operations are expensive. The virtual
    DOM acts as a lightweight copy that React can quickly traverse and compare.
    By batching updates and only applying necessary changes, React minimizes
    reflows and repaints, leading to better performance.
  `;  // ~90+ words
  const result2 = detector.analyze(adequateText, '', reasoningMessages);
  assert(result2.thinkingTooShort === false, 'Adequate thinking should not be flagged');
  assert(!result2.patterns.includes('insufficientThinking'), 'Should not detect insufficient thinking');
});

// Test 4: Thinking Length Analysis - Code Debug
testGroup('Thinking Length - Code Debug', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const codeMessages = [{
    role: 'user',
    content: 'Why is my code throwing a TypeError?'
  }];

  // Short thinking for code debug (NOT OK - needs 60 words)
  const shortText = "It's a type error with the variable.";  // ~7 words
  const result1 = detector.analyze(shortText, '', codeMessages);
  assert(result1.thinkingTooShort === true, 'Short thinking should be flagged for code debug');

  // Adequate thinking for code debug
  const adequateText = `
    The TypeError is likely occurring because you're trying to access a property
    or method on a value that is undefined or null. This commonly happens when
    you expect an object but receive undefined, or when you try to call a method
    on a primitive value. Check that your variables are properly initialized
    before use, and consider adding null/undefined checks or using optional
    chaining (?.) to safely access nested properties.
  `;  // ~70+ words
  const result2 = detector.analyze(adequateText, '', codeMessages);
  assert(result2.thinkingTooShort === false, 'Adequate thinking should not be flagged');
});

// Test 5: Combined Detection - Premature + Insufficient
testGroup('Combined: Premature Conclusion + Insufficient Thinking', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const reasoningMessages = [{
    role: 'user',
    content: 'Explain how neural networks learn.'
  }];

  // Both premature conclusion AND insufficient thinking
  const text = "Therefore the answer is backpropagation.";  // ~5 words + premature pattern
  const result = detector.analyze(text, '', reasoningMessages);

  assert(result.patterns.includes('prematureConclusion'), 'Should detect premature conclusion');
  assert(result.patterns.includes('insufficientThinking'), 'Should detect insufficient thinking');
  assert(result.score >= 3, 'Combined score should be significant');
  assert(result.severity !== 'NONE', 'Should have non-zero severity');
});

// Test 6: Opinion Query - More Lenient
testGroup('Opinion Query - More Lenient Thinking Length', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const opinionMessages = [{
    role: 'user',
    content: 'What do you think is better, React or Vue?'
  }];

  // Shorter thinking OK for opinion (40 words minimum)
  const text = "I think React is better for larger applications because of its ecosystem and component reusability. Vue is great for smaller projects with simpler requirements.";  // ~25 words
  const result = detector.analyze(text, '', opinionMessages);

  // 25 words < 40 minimum for opinion, should be flagged
  assert(result.thinkingTooShort === true, 'Should flag thinking below 40 words for opinion');
});

// Test 7: No Messages - Cannot Determine Complexity
testGroup('No Messages - Cannot Determine Complexity', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  // No messages provided
  const shortText = "The answer is 42.";  // ~4 words
  const result = detector.analyze(shortText, '', null);

  // Without messages, can't determine if thinking is too short
  assert(result.thinkingTooShort === false, 'Should not flag without message context');
});

// Test 8: Regression - Existing Patterns Still Work
testGroup('Regression - Existing Patterns Still Work', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  // Test existing patterns still work
  const uncertainText = "I'm not sure about this information.";
  const result1 = detector.analyze(uncertainText);
  assert(result1.patterns.includes('explicitUncertainty'), 'Existing patterns should still work');

  const cutoffText = "My knowledge cutoff is in 2024.";
  const result2 = detector.analyze(cutoffText);
  assert(result2.patterns.includes('knowledgeCutoff'), 'Knowledge cutoff pattern should still work');

  const hedgingText = "I think it might be possible.";
  const result3 = detector.analyze(hedgingText);
  assert(result3.patterns.includes('hedgingLanguage'), 'Hedging pattern should still work');
});

// Test 9: Pattern Weight Verification
testGroup('Pattern Weight Verification', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const text = "Therefore the answer is obvious.";
  const result = detector.analyze(text);

  // prematureConclusion has weight 2
  const prematureMatches = result.matches.filter(m => m.category === 'prematureConclusion');
  assert(prematureMatches.length > 0, 'Should have premature conclusion matches');
  assert(prematureMatches[0].weight === 2, 'Premature conclusion should have weight 2');
});

// Test 10: Thinking Length Metadata
testGroup('Thinking Length Metadata', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  const text = "This is a test with multiple words to check the word counting functionality.";
  const result = detector.analyze(text);

  assert(typeof result.thinkingLength === 'number', 'Should return thinking length');
  assert(result.thinkingLength > 0, 'Thinking length should be positive');
  assert(result.thinkingLength === 13, `Should count 13 words, got ${result.thinkingLength}`);
});

console.log(`\n${GREEN}✓ All premature conclusion detection tests passed!${RESET}\n`);
