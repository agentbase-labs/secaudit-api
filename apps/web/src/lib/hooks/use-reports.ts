'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBaseUrl, apiFetch, getAccessToken } from '../api-client';
import type {
  AdminPasswordRegenResult,
  AdminReportDetail,
  AdminReportUploadResult,
  ReportDetailForOwner,
  ReportDownloadResponse,
} from '@cs-platform/shared';

// ---- Client (owner) ----

/** Owner-only: report metadata + decrypted PDF password. */
export function useMyReport(reportId: string | undefined) {
  return useQuery({
    queryKey: ['reports', reportId],
    queryFn: () => apiFetch<ReportDetailForOwner>(`/reports/${reportId}`),
    enabled: Boolean(reportId),
    // Don't aggressively refetch — every fetch where password !== null is audit-logged.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Legacy password-gated download (kept for backwards-compat). */
export function useDownloadReport(reportId: string | undefined) {
  return useMutation({
    mutationFn: ({ password }: { password: string }) =>
      apiFetch<ReportDownloadResponse>(`/reports/${reportId}/download`, {
        method: 'POST',
        body: { password },
      }),
  });
}

/** Owner-only signed URL fetch (no password body — JWT-authenticated). */
export function useDownloadReportUrl(reportId: string | undefined) {
  return useMutation({
    mutationFn: () => apiFetch<ReportDownloadResponse>(`/reports/${reportId}/download`),
  });
}

// ---- Admin ----

export function useAdminReport(reportId: string | undefined) {
  return useQuery({
    queryKey: ['admin-reports', reportId],
    queryFn: () => apiFetch<AdminReportDetail>(`/admin/reports/${reportId}`),
    enabled: Boolean(reportId),
    refetchOnWindowFocus: false,
  });
}

export function useRegeneratePassword(reportId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      apiFetch<AdminPasswordRegenResult>(
        `/admin/reports/${reportId}/regenerate-password`,
        { method: 'POST', body: { reason } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-reports', reportId] });
    },
  });
}

/**
 * Multipart admin upload to `POST /admin/requests/:id/report`.
 * Bypasses `apiFetch` because we need to send `FormData` with the JWT bearer
 * token and not a JSON content-type. Mirrors the auth-refresh-on-401 of the
 * regular client.
 */
export function useAdminUploadReport(requestId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (pct: number) => void;
    }): Promise<AdminReportUploadResult> => {
      if (!requestId) throw new Error('Missing requestId');
      const url = `${apiBaseUrl()}/admin/requests/${requestId}/report`;
      const token = getAccessToken();

      // Use XHR for upload progress reporting (fetch lacks a request-progress hook).
      return new Promise<AdminReportUploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.responseType = 'json';
        xhr.withCredentials = true;
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        if (onProgress && xhr.upload) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
        }
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(xhr.response as AdminReportUploadResult);
          } else {
            const body = xhr.response as { message?: string } | null;
            const msg = body?.message ?? `HTTP ${xhr.status}`;
            const err = new Error(msg) as Error & { status?: number };
            err.status = xhr.status;
            reject(err);
          }
        };

        const fd = new FormData();
        fd.append('file', file, file.name);
        xhr.send(fd);
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-requests'] });
    },
  });
}
