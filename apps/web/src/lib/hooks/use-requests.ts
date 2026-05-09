'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  PaginatedResult,
  RequestDetail,
  RequestStatus,
  RequestSummary,
} from '@cs-platform/shared';

export function useMyRequests(params?: { status?: RequestStatus }) {
  return useQuery({
    queryKey: ['requests', params ?? {}],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      return apiFetch<PaginatedResult<RequestSummary>>(`/requests?${qs.toString()}`);
    },
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['requests', id],
    queryFn: () => apiFetch<RequestDetail>(`/requests/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) =>
      apiFetch<{ id: string; status: RequestStatus }>('/requests', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });
}
