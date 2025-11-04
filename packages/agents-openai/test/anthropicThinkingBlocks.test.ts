/**
 * Test for Anthropic extended thinking and interleaved thinking support.
 *
 * This test verifies the Anthropic API's requirements for thinking blocks
 * to be the first content in assistant messages when reasoning is enabled and tool
 * calls are present.
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 */

import { describe, it, expect } from 'vitest';
import { itemsToMessages } from '../src/openaiChatCompletionsConverter';
import { protocol } from '@openai/agents-core';

describe('Anthropic Thinking Blocks', () => {
  it('should preserve thinking blocks with tool calls', () => {
    // Step 1: Create output items with reasoning, thinking blocks, and tool calls
    const outputItems: protocol.OutputModelItem[] = [
      {
        type: 'reasoning',
        content: [],
        rawContent: [
          {
            type: 'reasoning_text',
            text: 'The user is asking about weather. Let me use the weather tool to get this information.',
          },
        ],
        encryptedContent: 'TestSignature123',
      },
      {
        type: 'function_call',
        callId: 'call_123',
        name: 'get_weather',
        arguments: '{"city": "Tokyo"}',
        status: 'completed',
      },
    ];

    // Step 2: Convert output items to messages with preserve_thinking_blocks enabled
    const messages = itemsToMessages(outputItems, true);

    // Step 3: Verify the assistant message structure
    const assistantMessages = messages.filter(
      (msg) =>
        msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls,
    );

    expect(assistantMessages).toHaveLength(1);

    const assistantMsg = assistantMessages[0];

    // Content must start with thinking blocks, not text
    expect(assistantMsg.content).toBeDefined();
    expect(Array.isArray(assistantMsg.content)).toBe(true);

    const content = assistantMsg.content as any[];
    expect(content.length).toBeGreaterThan(0);

    // First content must be 'thinking' type for Anthropic compatibility
    const firstContent = content[0];
    expect(firstContent.type).toBe('thinking');
    expect(firstContent.thinking).toBe(
      'The user is asking about weather. Let me use the weather tool to get this information.',
    );

    // Signature should also be preserved
    expect(firstContent.signature).toBe('TestSignature123');

    // Verify tool calls are preserved
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(Array.isArray(assistantMsg.tool_calls)).toBe(true);
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls![0].function.name).toBe('get_weather');
  });

  it('should not preserve thinking blocks when preserveThinkingBlocks is false', () => {
    const outputItems: protocol.OutputModelItem[] = [
      {
        type: 'reasoning',
        content: [],
        rawContent: [
          {
            type: 'reasoning_text',
            text: 'Some reasoning text',
          },
        ],
        encryptedContent: 'TestSignature123',
      },
      {
        type: 'function_call',
        callId: 'call_123',
        name: 'get_weather',
        arguments: '{"city": "Tokyo"}',
        status: 'completed',
      },
    ];

    // Convert without preserving thinking blocks
    const messages = itemsToMessages(outputItems, false);

    const assistantMessages = messages.filter(
      (msg) =>
        msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls,
    );

    expect(assistantMessages).toHaveLength(1);

    const assistantMsg = assistantMessages[0];

    // Content should not be an array of thinking blocks
    if (assistantMsg.content) {
      expect(Array.isArray(assistantMsg.content)).toBe(true);
      const content = assistantMsg.content as any[];
      if (content.length > 0) {
        expect(content[0].type).not.toBe('thinking');
      }
    }
  });

  it('should handle multiple thinking blocks', () => {
    const outputItems: protocol.OutputModelItem[] = [
      {
        type: 'reasoning',
        content: [],
        rawContent: [
          {
            type: 'reasoning_text',
            text: 'First thought',
          },
          {
            type: 'reasoning_text',
            text: 'Second thought',
          },
        ],
        encryptedContent: 'TestSignature456',
      },
      {
        type: 'function_call',
        callId: 'call_456',
        name: 'test_tool',
        arguments: '{}',
        status: 'completed',
      },
    ];

    const messages = itemsToMessages(outputItems, true);

    const assistantMessages = messages.filter(
      (msg) =>
        msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls,
    );

    expect(assistantMessages).toHaveLength(1);

    const assistantMsg = assistantMessages[0];
    const content = assistantMsg.content as any[];

    // Should have multiple thinking blocks
    expect(content.length).toBeGreaterThanOrEqual(2);
    expect(content[0].type).toBe('thinking');
    expect(content[0].thinking).toBe('First thought');
    expect(content[1].type).toBe('thinking');
    expect(content[1].thinking).toBe('Second thought');

    // Both should have the same signature
    expect(content[0].signature).toBe('TestSignature456');
    expect(content[1].signature).toBe('TestSignature456');
  });

  it('should handle reasoning without tool calls', () => {
    const outputItems: protocol.OutputModelItem[] = [
      {
        type: 'reasoning',
        content: [],
        rawContent: [
          {
            type: 'reasoning_text',
            text: 'Some reasoning',
          },
        ],
        encryptedContent: 'TestSignature789',
      },
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Here is my response',
          },
        ],
        status: 'completed',
      },
    ];

    const messages = itemsToMessages(outputItems, true);

    // Reasoning without tool calls should not create thinking blocks in content
    const assistantMessages = messages.filter(
      (msg) => msg.role === 'assistant',
    );
    expect(assistantMessages.length).toBeGreaterThan(0);

    // When reasoning is followed by a regular message, the reasoning is stored separately
    // and the message content is preserved as-is
    // Check that we have at least one assistant message
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    // Check for reasoning property on assistant messages
    const hasReasoning = assistantMessages.some((msg) => 'reasoning' in msg);
    expect(hasReasoning).toBe(true);
  });

  it('should preserve thinking blocks in assistant message (multi-turn fix)', () => {
    // This tests the bug fix: reasoning → assistant message should include thinking blocks
    // Previously, thinking blocks were only added to function_call messages
    const outputItems: protocol.OutputModelItem[] = [
      {
        type: 'reasoning',
        content: [],
        rawContent: [
          {
            type: 'reasoning_text',
            text: 'I need to analyze this request carefully.',
          },
        ],
        encryptedContent: 'HistorySignature',
      },
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'Let me help you with that.',
          },
        ],
        status: 'completed',
      },
    ];

    const messages = itemsToMessages(outputItems, true);

    // Find all assistant messages
    // Note: reasoning item creates one assistant message with reasoning property,
    // and the actual message item creates another assistant message with content
    const assistantMessages = messages.filter(
      (msg) => msg.role === 'assistant',
    );
    expect(assistantMessages.length).toBeGreaterThan(0);

    // Find the assistant message with content (not just reasoning property)
    const assistantMsgWithContent = assistantMessages.find(
      (msg) => msg.content && Array.isArray(msg.content),
    );
    expect(assistantMsgWithContent).toBeDefined();

    const content = assistantMsgWithContent!.content as any[];

    // Should have at least 2 items: thinking block + text
    expect(content.length).toBeGreaterThanOrEqual(2);

    // First item should be thinking block
    expect(content[0].type).toBe('thinking');
    expect(content[0].thinking).toBe(
      'I need to analyze this request carefully.',
    );
    expect(content[0].signature).toBe('HistorySignature');

    // Second item should be the text content
    expect(content[1].type).toBe('text');
    expect(content[1].text).toBe('Let me help you with that.');
  });

  it('should handle empty reasoning content', () => {
    const outputItems: protocol.OutputModelItem[] = [
      {
        type: 'reasoning',
        content: [],
        rawContent: [],
        encryptedContent: 'TestSignature000',
      },
      {
        type: 'function_call',
        callId: 'call_000',
        name: 'test_tool',
        arguments: '{}',
        status: 'completed',
      },
    ];

    const messages = itemsToMessages(outputItems, true);

    const assistantMessages = messages.filter(
      (msg) =>
        msg.role === 'assistant' && 'tool_calls' in msg && msg.tool_calls,
    );

    expect(assistantMessages).toHaveLength(1);

    // Should not have thinking blocks if rawContent is empty
    const assistantMsg = assistantMessages[0];
    if (assistantMsg.content) {
      const content = assistantMsg.content as any[];
      expect(content.length).toBe(0);
    }
  });
});
