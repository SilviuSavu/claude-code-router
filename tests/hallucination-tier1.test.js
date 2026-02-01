// Test suite for Tier 1 hallucination detection enhancements
const { HallucinationDetector } = require('../plugins/glm47-transformer/hallucination-detector.js');
const { HallucinationIntervention } = require('../plugins/glm47-transformer/hallucination-intervention.js');

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

// Test 1: Enhanced Severity Scoring
testGroup('Enhanced Severity Scoring', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  // Test LOW severity
  const lowText = "I think this might be correct";
  const lowAnalysis = detector.analyze(lowText);
  assert(lowAnalysis.severity === 'LOW', `Expected LOW severity, got ${lowAnalysis.severity}`);
  assert(lowAnalysis.normalizedScore > 0 && lowAnalysis.normalizedScore < 0.25, 'Normalized score should be < 0.25 for LOW');
  assert(lowAnalysis.confidence >= 0, 'Confidence should be calculated');

  // Test MEDIUM/HIGH severity (hedging + uncertainty patterns)
  const mediumText = "I'm not sure about this but I think maybe it could be true, possibly";
  const mediumAnalysis = detector.analyze(mediumText);
  assert(['MEDIUM', 'HIGH'].includes(mediumAnalysis.severity), `Expected MEDIUM/HIGH severity, got ${mediumAnalysis.severity}`);

  // Test HIGH severity
  const highText = "I don't know if this is correct. I'm not certain. I can't verify this information.";
  const highAnalysis = detector.analyze(highText);
  assert(['HIGH', 'CRITICAL'].includes(highAnalysis.severity), `Expected HIGH/CRITICAL severity, got ${highAnalysis.severity}`);

  // Test confidence based on pattern diversity
  const singlePatternText = "I think";
  const singleAnalysis = detector.analyze(singlePatternText);

  const multiPatternText = "I'm not sure and I don't know and my knowledge cutoff is 2025";
  const multiAnalysis = detector.analyze(multiPatternText);

  assert(multiAnalysis.confidence > singleAnalysis.confidence,
    `Multi-pattern confidence (${multiAnalysis.confidence}) should be higher than single-pattern (${singleAnalysis.confidence})`);
});

// Test 2: Context-Aware Adaptive Thresholds
testGroup('Context-Aware Adaptive Thresholds', () => {
  const detector = new HallucinationDetector({
    threshold: 3,
    contextAwareThresholds: {
      factualQuery: 3,
      opinionQuery: 6,
      reasoningQuery: 4,
      futureQuery: 7,
      codeDebug: 2
    }
  });

  // Test factual query - strict threshold
  const factualMessages = [{
    role: 'user',
    content: 'What is the latest version of React?'
  }];
  const factualText = "I think maybe it's version 18";
  const factualAnalysis = detector.analyze(factualText, '', factualMessages);
  const factualIntervention = detector.shouldIntervene({
    ...factualAnalysis,
    messages: factualMessages
  });

  // Test opinion query - lenient threshold (hedging allowed)
  const opinionMessages = [{
    role: 'user',
    content: 'What do you think is better, React or Vue?'
  }];
  const opinionText = "I think React might be better for larger projects";
  const opinionAnalysis = detector.analyze(opinionText, '', opinionMessages);
  const opinionIntervention = detector.shouldIntervene({
    ...opinionAnalysis,
    messages: opinionMessages
  });

  // Opinion query should NOT intervene (hedging is normal)
  assert(!opinionIntervention, 'Opinion query with hedging should not trigger intervention');

  // Test code debug - very strict threshold
  const codeMessages = [{
    role: 'user',
    content: 'Why is my function throwing an error?'
  }];
  const codeText = "I think there might be an issue";
  const codeAnalysis = detector.analyze(codeText, '', codeMessages);
  const codeIntervention = detector.shouldIntervene({
    ...codeAnalysis,
    messages: codeMessages
  });

  // Code debug should be more sensitive
  assert(codeAnalysis.score >= 1, 'Code debug query should detect patterns');

  // Test future query - very lenient
  const futureMessages = [{
    role: 'user',
    content: 'What features will be added in the future?'
  }];
  const futureText = "It might include new APIs and could have better performance";
  const futureAnalysis = detector.analyze(futureText, '', futureMessages);
  const futureIntervention = detector.shouldIntervene({
    ...futureAnalysis,
    messages: futureMessages
  });

  // Future query should allow speculation
  assert(!futureIntervention, 'Future query with speculation should not trigger intervention');
});

// Test 3: Query Classifier
testGroup('Query Classifier', () => {
  const detector = new HallucinationDetector({ threshold: 3 });
  const classifier = detector.queryClassifier;

  // Test factual query classification
  const factualMessages = [{ role: 'user', content: 'What is the current version of Node.js?' }];
  const factualType = classifier.classify(factualMessages);
  assert(factualType === 'factualQuery', `Expected factualQuery, got ${factualType}`);

  // Test opinion query classification
  const opinionMessages = [{ role: 'user', content: 'Which is better, TypeScript or JavaScript?' }];
  const opinionType = classifier.classify(opinionMessages);
  assert(opinionType === 'opinionQuery', `Expected opinionQuery, got ${opinionType}`);

  // Test reasoning query classification
  const reasoningMessages = [{ role: 'user', content: 'How does React\'s virtual DOM work?' }];
  const reasoningType = classifier.classify(reasoningMessages);
  assert(reasoningType === 'reasoningQuery', `Expected reasoningQuery, got ${reasoningType}`);

  // Test code debug classification
  const debugMessages = [{ role: 'user', content: 'Why is my code throwing a syntax error?' }];
  const debugType = classifier.classify(debugMessages);
  assert(debugType === 'codeDebug', `Expected codeDebug, got ${debugType}`);

  // Test future query classification
  const futureMessages = [{ role: 'user', content: 'What features will be added in Next.js 16?' }];
  const futureType = classifier.classify(futureMessages);
  assert(futureType === 'futureQuery', `Expected futureQuery, got ${futureType}`);
});

// Test 4: Intervention Request Creation
testGroup('Intervention Request Creation', () => {
  const intervention = new HallucinationIntervention({
    autoIntervene: true,
    forceWebSearch: true,
    debug: true
  });

  const originalRequest = {
    model: 'glm-4.7',
    messages: [
      { role: 'user', content: 'What is the latest React version?' }
    ],
    max_tokens: 1000
  };

  const analysis = {
    score: 6,
    severity: 'HIGH',
    patterns: ['explicitUncertainty', 'knowledgeCutoff'],
    matches: [
      { category: 'explicitUncertainty', weight: 3 },
      { category: 'knowledgeCutoff', weight: 3 }
    ]
  };

  const interventionRequest = intervention.createInterventionRequest(originalRequest, analysis);

  // Verify intervention request structure
  assert(interventionRequest._hallucinationIntervention === true, 'Should be marked as intervention');
  assert(interventionRequest.messages.length > originalRequest.messages.length, 'Should have additional system message');
  assert(interventionRequest.messages[0].role === 'system', 'First message should be system prompt');
  assert(interventionRequest.tools && interventionRequest.tools.length > 0, 'Should have web_search tool');
  assert(interventionRequest.tools[0].type === 'web_search', 'Tool should be web_search');
  assert(interventionRequest.tool_choice, 'Should have tool_choice');
  assert(interventionRequest._interventionReason, 'Should have intervention reason');
});

// Test 5: Infinite Loop Protection
testGroup('Infinite Loop Protection', () => {
  const intervention = new HallucinationIntervention({ autoIntervene: true });

  const originalRequest = {
    model: 'glm-4.7',
    messages: [{ role: 'user', content: 'Test' }]
  };

  const analysis = {
    score: 6,
    patterns: ['explicitUncertainty'],
    matches: [{ category: 'explicitUncertainty', weight: 3 }]
  };

  const interventionRequest = intervention.createInterventionRequest(originalRequest, analysis);

  assert(interventionRequest._hallucinationIntervention === true, 'Intervention request should be marked');

  // Simulate the transformer checking for intervention flag
  // In index.js, we check: if (!request._hallucinationIntervention)
  // This prevents storing the intervention request as "original"
  const isIntervention = interventionRequest._hallucinationIntervention;
  assert(isIntervention, 'Should prevent infinite loops by checking flag');
});

// Test 6: Pattern Detection Still Works
testGroup('Pattern Detection Regression Test', () => {
  const detector = new HallucinationDetector({ threshold: 3 });

  // Test explicit uncertainty
  const uncertainText = "I'm not sure about this information";
  const uncertainAnalysis = detector.analyze(uncertainText);
  assert(uncertainAnalysis.detected, 'Should detect uncertainty');
  assert(uncertainAnalysis.patterns.includes('explicitUncertainty'), 'Should identify uncertainty pattern');

  // Test knowledge cutoff
  const cutoffText = "My knowledge cutoff is in 2024";
  const cutoffAnalysis = detector.analyze(cutoffText);
  assert(cutoffAnalysis.detected, 'Should detect knowledge cutoff');
  assert(cutoffAnalysis.patterns.includes('knowledgeCutoff'), 'Should identify cutoff pattern');

  // Test contradictory reasoning
  const contradictText = "It's true but however it's false but actually it might be true";
  const contradictAnalysis = detector.analyze(contradictText);
  assert(contradictAnalysis.detected, 'Should detect contradictions');
  assert(contradictAnalysis.patterns.includes('contradictoryReasoning'), 'Should identify contradiction pattern');
});

console.log(`\n${GREEN}✓ All Tier 1 tests passed!${RESET}\n`);
