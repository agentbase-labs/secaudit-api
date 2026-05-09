import { AssetType, RequestStatus, TestingType } from '../enums';
import type { RequestDetails } from '../validation/request-details';
import type { ReportSummary } from './report';

export interface RequestSummary {
  id: string;
  assetType: AssetType;
  testingType: TestingType;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  hasReport: boolean;
}

export interface RequestDetail extends RequestSummary {
  details: RequestDetails;
  reports: ReportSummary[];
}

export interface AdminRequestRow {
  id: string;
  user: { id: string; email: string; companyName: string | null; fullName: string };
  assetType: AssetType;
  testingType: TestingType;
  status: RequestStatus;
  createdAt: string;
  hasReport: boolean;
}

export interface AdminRequestDetail extends AdminRequestRow {
  updatedAt: string;
  details: RequestDetails;
  reports: ReportSummary[];
}

export interface SignedUploadUrlResponse {
  uploadUrl: string;
  r2Key: string;
  expiresAt: string;
  headers: Record<string, string>;
}
