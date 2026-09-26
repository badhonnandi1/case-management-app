import { createWorkerApp } from './app.js';
import type { WorkerEnv } from './types.js';

const app = createWorkerApp();

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return app(request, env);
  },
};
