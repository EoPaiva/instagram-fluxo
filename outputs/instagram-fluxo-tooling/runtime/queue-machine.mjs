import { assign, createActor, fromPromise, setup, toPromise } from 'xstate';

const operationMachine = setup({
  actors: {
    execute: fromPromise(({ input }) => Promise.resolve().then(() => {
      input.controller.signal.throwIfAborted();
      return input.execute(input.controller.signal);
    })),
  },
  guards: {
    isNewDispatch: ({ context, event }) => !context.dispatched.has(event.username),
  },
  actions: {
    abort: ({ context }) => context.controller.abort(),
    reserveDispatch: assign({
      dispatched: ({ context, event }) => new Set([...context.dispatched, event.username]),
    }),
    captureResult: assign({
      result: ({ event }) => ({ ok: true, value: event.output }),
    }),
    captureError: assign({
      result: ({ event }) => ({ ok: false, error: event.error }),
    }),
  },
}).createMachine({
  context: ({ input }) => ({ ...input, dispatched: new Set(), result: null }),
  initial: 'ready',
  states: {
    ready: { on: { START: 'active' } },
    active: {
      invoke: {
        src: 'execute',
        input: ({ context }) => context,
        onDone: { target: 'settled', actions: 'captureResult' },
        onError: { target: 'settled', actions: 'captureError' },
      },
      initial: 'running',
      states: {
        running: {
          on: { STOP: { target: 'stopping', actions: 'abort' } },
          initial: 'ready',
          states: {
            ready: { on: { SAVE_DISPATCH: { guard: 'isNewDispatch', target: 'saving', actions: 'reserveDispatch' } } },
            saving: { on: { DISPATCH_SAVED: 'ready' } },
          },
        },
        // Keep the invocation alive until it has saved its final result.
        stopping: {},
      },
    },
    settled: { type: 'final' },
  },
  output: ({ context }) => context.result,
});

export function createOperation(execute) {
  const controller = new AbortController();
  const actor = createActor(operationMachine, { input: { execute, controller } }).start();
  const { signal } = controller;
  const readyForDispatch = { active: { running: 'ready' } };
  const savingDispatch = { active: { running: 'saving' } };

  return {
    signal,
    async start() {
      const completion = toPromise(actor);
      actor.send({ type: 'START' });
      const result = await completion;
      if (!result.ok) throw result.error;
      return result.value;
    },
    requestStop() {
      if (!actor.getSnapshot().matches('active.running')) return false;
      actor.send({ type: 'STOP' });
      return true;
    },
    async checkpointDispatch(username, save) {
      signal.throwIfAborted();
      if (!actor.getSnapshot().matches(readyForDispatch)) throw new Error('Outra ação da fila está sendo registrada.');
      actor.send({ type: 'SAVE_DISPATCH', username });
      if (!actor.getSnapshot().matches(savingDispatch)) throw new Error('O perfil já teve uma ação registrada nesta execução.');
      await save();
      signal.throwIfAborted();
      actor.send({ type: 'DISPATCH_SAVED' });
    },
  };
}

