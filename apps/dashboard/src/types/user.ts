export interface UserProfile {
  id: number;
  email: string;
  name: string | null;
  familyName: string | null;
  givenName: string | null;
  picture: string | null;
  createdAt: string | null;
}

export interface ApiResponse<T> {
  data?: T | null;
}
