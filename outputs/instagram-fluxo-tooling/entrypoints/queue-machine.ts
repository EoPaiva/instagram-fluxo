import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { createOperation } from '../runtime/queue-machine.mjs';

export default defineUnlistedScript(() => {
  Object.assign(globalThis, { instagramFluxoQueueMachine: { createOperation } });
});
