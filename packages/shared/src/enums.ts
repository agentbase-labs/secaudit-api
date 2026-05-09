export enum UserRole {
  CLIENT = 'client',
  ADMIN = 'admin',
}

export enum AssetType {
  ATTACK_SURFACE = 'attack_surface',
  WEBSITE = 'website',
  EXTERNAL_INFRA = 'external_infra',
  MOBILE_APP = 'mobile_app',
}

export enum TestingType {
  VULN_SCAN = 'vuln_scan',
  MANUAL_PENTEST = 'manual_pentest',
  RED_TEAM = 'red_team',
  API_TEST = 'api_test',
  SOURCE_REVIEW = 'source_review',
}

export enum RequestStatus {
  SUBMITTED = 'submitted',
  IN_REVIEW = 'in_review',
  TESTING_IN_PROGRESS = 'testing_in_progress',
  REPORT_READY = 'report_ready',
  COMPLETED = 'completed',
  // Phase 2 additions (reserved now to avoid migrations later)
  QUEUED = 'queued',
  RUNNING = 'running',
  GENERATING = 'generating',
  FAILED = 'failed',
}

export enum MobilePlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

export enum Environment {
  PROD = 'prod',
  TEST = 'test',
}
