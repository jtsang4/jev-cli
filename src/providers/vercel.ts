import { createGateway } from '@ai-sdk/gateway';
import type { Experimental_EvaluationModelV4 as EvaluationModelV4 } from '@ai-sdk/provider';

import type { ResolvedProvider } from './index.ts';

/** Vercel AI Gateway. The key is passed explicitly so config.yaml works without env vars. */
export function createVercelEvaluationModel(resolved: ResolvedProvider): EvaluationModelV4 {
  const gateway = createGateway({
    apiKey: resolved.apiKey,
    ...(resolved.baseURL === undefined ? {} : { baseURL: resolved.baseURL }),
  });
  return gateway.evaluationModel(resolved.model);
}
