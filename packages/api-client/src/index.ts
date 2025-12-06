import fetchFromCrossFetch from 'cross-fetch';

export interface IdentikApiClientOptions {
  baseUrl?: string;
  accessToken?: string;
  customFetch?: typeof fetch;
}

export interface NameAvailabilityResponse {
  available: boolean;
  suggested?: string;
}

export interface PurchaseNameRequest {
  name: string;
}

export interface PurchaseNameResponse {
  identik_name: string;
  status: 'active' | 'pending';
}

export interface SignResponse {
  identik_name: string;
  file_sha256: string;
  fingerprint: string;
  signature: string;
}

export interface VerifyResponse {
  verified: boolean;
  score: number;
  identik_name?: string;
  label: 'Trusted' | 'Limited history' | 'Warning' | 'Not protected';
  message: string;
  details?: Record<string, unknown>;
}

export class IdentikApiClient {
  private accessToken?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IdentikApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api';
    this.accessToken = options.accessToken;
    this.fetchImpl = options.customFetch ?? globalThis.fetch ?? (fetchFromCrossFetch as unknown as typeof fetch);
  }

  public setAccessToken(token?: string) {
    this.accessToken = token;
  }

  public async checkNameAvailability(name: string): Promise<NameAvailabilityResponse> {
    return this.request<NameAvailabilityResponse>(`/v1/names/available?name=${encodeURIComponent(name)}`);
  }

  public async purchaseName(body: PurchaseNameRequest): Promise<PurchaseNameResponse> {
    return this.request<PurchaseNameResponse>(`/v1/names/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  public async fetchReputation(identikName: string) {
    return this.request(`/v1/names/${encodeURIComponent(identikName)}/reputation`);
  }

  public async signPhoto(file: FileSource, identikName: string): Promise<SignResponse> {
    const formData = new FormData();
    formData.append('identikName', identikName);
    formData.append('file', await toBlob(file), 'photo.jpg');
    return this.request<SignResponse>('/v1/sign', { method: 'POST', body: formData });
  }

  public async verifyPhoto(file: FileSource): Promise<VerifyResponse> {
    const formData = new FormData();
    formData.append('file', await toBlob(file), 'photo.jpg');
    return this.request<VerifyResponse>('/v1/verify', { method: 'POST', body: formData });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = { ...(init.headers ?? {}) };

    if (!(init.body instanceof FormData)) {
      headers['Accept'] = 'application/json';
    }

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });

    if (!response.ok) {
      const errorText = await safeParseError(response);
      throw new Error(errorText ?? response.statusText);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as T;
  }
}

const safeParseError = async (response: Response) => {
  try {
    const parsed = await response.json();
    if (typeof parsed?.message === 'string') {
      return parsed.message;
    }
    return JSON.stringify(parsed);
  } catch (error) {
    return response.statusText;
  }
};

type FileSource = Blob | ArrayBuffer | ArrayBufferView;

const toBlob = async (file: FileSource): Promise<Blob> => {
  if (file instanceof Blob) {
    return file;
  }

  if (file instanceof ArrayBuffer) {
    return new Blob([file]);
  }

  if (ArrayBuffer.isView(file)) {
    return new Blob([file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)]);
  }

  return new Blob([file as ArrayBuffer]);
};
