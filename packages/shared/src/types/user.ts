import { UserRole } from '../enums';

export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  companyName: string | null;
  role: UserRole;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthLoginResponse {
  accessToken: string;
  user: PublicUser;
}
