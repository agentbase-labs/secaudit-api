'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api-client';
import type { PaginatedResult, PublicUser } from '@cs-platform/shared';

export function useAdminUsers(params?: { q?: string }) {
  return useQuery({
    queryKey: ['admin-users', params ?? {}],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (params?.q) qs.set('q', params.q);
      return apiFetch<PaginatedResult<PublicUser>>(`/admin/users?${qs.toString()}`);
    },
  });
}
