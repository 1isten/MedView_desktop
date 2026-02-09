import type { ConnectRouter } from '@connectrpc/connect';
import { MainService } from './gen/rpc/main/v1/main_pb';

import { setTimeout as sleep } from 'timers/promises';

export default (router: ConnectRouter) => router.service(MainService, {
  async *ping(req, context) {
    const n = req.n > 0 ? req.n : 10;
    const msg = req.msg || 'PONG';
    for (let i = 0; i < n; i++) {
      const chunk = {
        msg: `${msg} (${i + 1}/${n})`,
        timestamp: Date.now().toString(),
      };
      console.debug(chunk);
      yield chunk;
      await sleep(1000);
    }
  },
});
