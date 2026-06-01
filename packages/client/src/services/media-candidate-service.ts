import { apiFetch } from "@/lib/api-client";
import {
  mediaCandidateResolveResponseSchema,
  type MediaCandidateResolveRequest,
  type MediaCandidateResolveResponse,
} from "@/lib/api/schemas/media";

export const mediaCandidateService = {
  async resolve(
    request: MediaCandidateResolveRequest,
    signal?: AbortSignal,
  ): Promise<MediaCandidateResolveResponse> {
    return await apiFetch("/api/app/media/candidates", mediaCandidateResolveResponseSchema, {
      method: "POST",
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
  },
};
