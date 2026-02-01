import { MultiSessionManager } from '../plugins/glm47-transformer/multi-session-manager.js';

describe('Multi-Session Manager', () => {
  it('should track multiple concurrent conversations', () => {
    const msm = new MultiSessionManager();

    msm.registerSession('agent-1', 'conv-1');
    msm.registerSession('agent-2', 'conv-2');
    msm.registerSession('agent-3', 'conv-1');

    expect(msm.getSessionCount()).toBe(3);
    expect(msm.hasSession('agent-1')).toBe(true);
    expect(msm.hasSession('agent-3')).toBe(true);
  });

  it('should share thinking blocks across agents on same conversation', () => {
    const msm = new MultiSessionManager();

    msm.storeThinking('conv-1', 'agent-1', 'thinking about problem');

    const thinking = msm.getThinking('conv-1', 'agent-2');
    expect(thinking).toBe('thinking about problem');
  });

  it('should keep separate thinking for different conversations', () => {
    const msm = new MultiSessionManager();

    msm.storeThinking('conv-1', 'agent-1', 'thinking for conv 1');
    msm.storeThinking('conv-2', 'agent-1', 'thinking for conv 2');

    const thinking1 = msm.getThinking('conv-1', 'agent-1');
    const thinking2 = msm.getThinking('conv-2', 'agent-1');

    expect(thinking1).toBe('thinking for conv 1');
    expect(thinking2).toBe('thinking for conv 2');
    expect(thinking1).not.toBe(thinking2);
  });

  it('should clean up old sessions', async () => {
    const msm = new MultiSessionManager({ maxAgeMs: 100 });

    msm.registerSession('agent-1', 'conv-1');

    expect(msm.getSessionCount()).toBe(1);

    await new Promise(resolve => {
      setTimeout(() => {
        msm.cleanupExpiredSessions();
        expect(msm.getSessionCount()).toBe(0);
        resolve();
      }, 150);
    });
  });
});
