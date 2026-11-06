import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TmdbHttpOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

@Injectable()
export class TmdbHttpClient {
  private readonly logger = new Logger(TmdbHttpClient.name);
  private readonly baseUrl: string;
  private readonly readAccessToken: string | null;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = (
      this.configService.get<string>('TMDB_BASE_URL') || 'https://api.themoviedb.org/3'
    ).replace(/\/$/, '');
    this.readAccessToken = this.configService.get<string>('TMDB_READ_ACCESS_TOKEN') || null;
    this.defaultTimeoutMs = 10000;
    this.defaultMaxRetries = 3;

    if (!this.readAccessToken) {
      this.logger.warn(
        'TMDB_READ_ACCESS_TOKEN is not configured. TMDB API requests will fail authentication.',
      );
    }
  }

  public getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (this.readAccessToken) {
      headers.Authorization = `Bearer ${this.readAccessToken}`;
    }

    return headers;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public async get<T>(
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {},
    options?: TmdbHttpOptions,
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = new URL(`${this.baseUrl}${cleanEndpoint}`);

    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) {
        url.searchParams.set(key, String(val));
      }
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = options?.maxRetries ?? this.defaultMaxRetries;

    return this.requestWithRetry<T>(url.toString(), cleanEndpoint, timeoutMs, maxRetries);
  }

  private async requestWithRetry<T>(
    url: string,
    cleanEndpoint: string,
    timeoutMs: number,
    maxRetries: number,
  ): Promise<T> {
    let attempt = 0;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: this.getHeaders(),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return (await response.json()) as T;
        }

        const status = response.status;

        // Non-retryable client errors (400, 401, 403, 404)
        if (status === 401 || status === 403) {
          throw new Error(
            `TMDB authentication failed (HTTP ${status}). Please verify your credentials.`,
          );
        }
        if (status === 404) {
          throw new Error(`Resource not found on TMDB (HTTP 404): ${cleanEndpoint}`);
        }
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`TMDB request rejected with client error (HTTP ${status}).`);
        }

        // Retryable: 429 (Rate Limit) or 5xx (Server Error)
        if (attempt < maxRetries) {
          let delayMs = Math.pow(2, attempt) * 500; // Exponential backoff: 500ms, 1000ms, 2000ms...

          if (status === 429) {
            const retryAfterHeader = response.headers.get('Retry-After');
            if (retryAfterHeader) {
              const seconds = parseInt(retryAfterHeader, 10);
              if (!isNaN(seconds) && seconds > 0) {
                delayMs = seconds * 1000;
              }
            }
            this.logger.warn(
              `TMDB rate limit encountered (429). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries}).`,
            );
          } else {
            this.logger.warn(
              `TMDB server error (HTTP ${status}). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries}).`,
            );
          }

          await this.sleep(delayMs);
          attempt++;
          continue;
        }

        throw new Error(`TMDB request failed with status ${status} after ${maxRetries} retries.`);
      } catch (err: unknown) {
        clearTimeout(timeoutId);

        const error = err as Error;
        const isAbort = error.name === 'AbortError' || error.message?.includes('aborted');

        if (attempt < maxRetries && (isAbort || error.message?.includes('fetch failed'))) {
          const delayMs = Math.pow(2, attempt) * 500;
          this.logger.warn(
            `Network failure or timeout (${error.message}). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries}).`,
          );
          await this.sleep(delayMs);
          attempt++;
          continue;
        }

        throw error;
      }
    }

    throw new Error(`TMDB request failed after maximum retries.`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
