import { initTRPC } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { createClient, createRouterTransport } from '@connectrpc/connect';
import routes from './connect';
import { MainService } from './gen/rpc/main/v1/main_pb';

import { type MessageInitShape } from '@bufbuild/protobuf';
import {
  PingRequestSchema,
} from './gen/rpc/main/v1/test_pb';

const t = initTRPC.create();
const client = createClient(MainService, createRouterTransport(routes));

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  ping: publicProcedure.input(req => req as MessageInitShape<typeof PingRequestSchema>).query(async ({ input, ctx, signal }) => client.ping({ ...input }, { signal })),
});
export type AppRouter = typeof appRouter;

export const handler: (req: Request) => Promise<Response> = req => fetchRequestHandler({
  endpoint: '/rpc', // connect://localhost/rpc
  req,
  router: appRouter,
  createContext({ req, resHeaders }) {
    const auth = req.headers.get('Authorization');
    const token = auth ? (auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth) : undefined;
    // ...
    return {
      req,
      resHeaders,
      token,
      // ...
    };
  },
  onError({ error, type, path }) {
    if (path) {
      // console.error(path, `[${type}]`, error.message);
    }
  },
});
