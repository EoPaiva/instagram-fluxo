import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperation } from '../runtime/queue-machine.mjs';

test('only one durable dispatch is allowed for each profile in an execution', async () => {
  const sent = [];
  const operation = createOperation(async () => {
    for (const name of ['primeiro', 'segundo']) {
      await operation.checkpointDispatch(name, async () => sent.push('saved:' + name));
      sent.push('sent:' + name);
    }
    await assert.rejects(operation.checkpointDispatch('primeiro', () => assert.fail()), /já teve/);
    return 2;
  });
  assert.equal(await operation.start(), 2);
  assert.deepEqual(sent, ['saved:primeiro', 'sent:primeiro', 'saved:segundo', 'sent:segundo']);
  assert.equal(operation.requestStop(), false);
});

test('stop during a checkpoint prevents dispatch and waits for the operation cleanup', async () => {
  const events = [];
  const operation = createOperation(async () => {
    try {
      await operation.checkpointDispatch('perfil_teste', async () => {
        assert.equal(operation.requestStop(), true);
        assert.equal(operation.requestStop(), false);
        events.push('saved');
      });
      assert.fail('A stopped operation must not send another action');
    } finally {
      await Promise.resolve();
      events.push('finished cleanup');
    }
  });
  await assert.rejects(operation.start(), { name: 'AbortError' });
  assert.deepEqual(events, ['saved', 'finished cleanup']);
});

test('an unsuccessful checkpoint stops the executor without authorizing a later dispatch', async () => {
  const failedWrite = new Error('checkpoint unavailable');
  const operation = createOperation(async () => {
    await assert.rejects(operation.checkpointDispatch('perfil_teste', async () => {
      throw failedWrite;
    }), error => error === failedWrite);
    await assert.rejects(operation.checkpointDispatch('outro_perfil', () => assert.fail()), /está sendo registrada/);
    throw failedWrite;
  });
  await assert.rejects(operation.start(), error => error === failedWrite);
});
