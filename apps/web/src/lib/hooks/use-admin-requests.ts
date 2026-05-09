'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type {
  AdminRequestDetail,
  AdminRequestRow,
  PaginatedResult,
  RequestStatus,
} from '@cs-platform/shared';

export function useAdminRequests(params?: { status?: RequestStatus; q?: string }) {
  return useQuery({
    queryKey: ['admin-requests', params ?? {}],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.q) qs.set('q', params.q);
      return apiFetch<PaginatedResult<AdminRequestRow>>(`/admin/requests?${qs.toString()}`);
    },
  });
}

export function useAdminRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-requests', id],
    queryFn: () => apiFetch<AdminRequestDetail>(`/admin/requests/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdateStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: RequestStatus; note?: string }) =>
      apiFetch(`/admin/requests/${id}/status`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-requests'] });
    },
  });
}
