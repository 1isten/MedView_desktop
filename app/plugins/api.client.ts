import { createTRPCClient, httpBatchLink, httpBatchStreamLink } from '@trpc/client';
import type { AppRouter as TRPCRouter } from '@/../server/trpc';

export default defineNuxtPlugin(({ vueApp: app }) => {
  const trpc = ({ stream = false } = {}) => {
    const Link = stream ? httpBatchStreamLink : httpBatchLink;
    return createTRPCClient<TRPCRouter>({
      links: [
        Link({
          url: 'connect://localhost/rpc',
          headers() {
            return {
              // 'Authorization': `Bearer ${token}`,
            };
          },
        }),
      ],
    });
  };

  return {
    provide: {
      trpc, // useNuxtApp().$trpc
    },
  };
});
