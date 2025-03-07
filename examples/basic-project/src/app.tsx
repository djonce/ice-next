import { defineAppConfig } from 'ice';
import { defineAuthConfig } from '@ice/plugin-auth/esm/types';
import { isWeb, isNode } from '@uni/env';
import type { GetAppData } from 'ice';

if (process.env.ICE_CORE_ERROR_BOUNDARY === 'true') {
  console.error('__REMOVED__');
}

console.log('__LOG__');
console.warn('__WARN__');
console.error('__ERROR__');
console.log('process.env.HAHA', process.env.HAHA);

if (isWeb) {
  console.error('__IS_WEB__');
}

if (isNode) {
  console.error('__IS_NODE__');
}

export const auth = defineAuthConfig((data) => {
  // fetch auth data
  return {
    initialAuth: {
      admin: data?.auth?.admin,
    },
  };
});

export default defineAppConfig({
  app: {
    rootId: 'app',
  },
});

export const getAppData: GetAppData = () => {
  return new Promise((resolve) => {
    resolve({
      title: 'gogogogo',
      auth: {
        admin: true,
      },
    });
  });
};