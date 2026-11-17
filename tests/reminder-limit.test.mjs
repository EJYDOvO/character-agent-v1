import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_REMINDER_CHARS as BUILD_LIMIT} from '../packages/character-definition/card.mjs';
import {MAX_REMINDER_CHARS as CHARACTER_LIMIT} from '../packages/character-memory-tools/reminder.mjs';
import {MAX_STYLE_REMINDER_CHARS as INTERACTION_LIMIT} from '../packages/interaction-policy/policy.mjs';

// The plugins ship as separate packages and cannot share a constant, so each
// keeps its own copy. The build must never accept a reminder that either
// plugin would reject at Host start.
test('the build, Character and Interaction share one reminder limit', () => {
  assert.equal(CHARACTER_LIMIT, BUILD_LIMIT);
  assert.equal(INTERACTION_LIMIT, BUILD_LIMIT);
});
