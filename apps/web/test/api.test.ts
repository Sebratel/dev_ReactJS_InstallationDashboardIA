import assert from 'node:assert/strict';
import test from 'node:test';
import { ehAbortError } from '../src/api.ts';

test('ehAbortError: reconhece o DOMException que fetch() lança ao abortar', () => {
  assert.equal(ehAbortError(new DOMException('The user aborted a request.', 'AbortError')), true);
});

test('ehAbortError: outro DOMException não é abort', () => {
  assert.equal(ehAbortError(new DOMException('nope', 'NotFoundError')), false);
});

test('ehAbortError: erro comum não é abort', () => {
  assert.equal(ehAbortError(new Error('falhou')), false);
  assert.equal(ehAbortError('string qualquer'), false);
  assert.equal(ehAbortError(null), false);
});
