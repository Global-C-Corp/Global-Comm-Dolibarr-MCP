import axios, { AxiosInstance, AxiosResponse } from 'axios';

export class DolibarrAPI {
  private client: AxiosInstance;
  public baseURL: string;

  constructor(baseURL: string, apiKey: string) {
    // Normalize URL - remove trailing slash and ensure we point to the right base
    let url = baseURL.replace(/\/$/, '');
    // If it doesn't already end with api/index.php, append it
    if (!url.endsWith('api/index.php')) {
      url = `${url}/api/index.php`;
    }
    this.baseURL = url;

    this.client = axios.create({
      baseURL: url,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'DOLAPIKEY': apiKey,
      },
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: 1024 * 1024,
      maxBodyLength: 64 * 1024,
    });

    // Interceptor for clean error messages
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const status = error.response.status;
          throw new Error(`Dolibarr API returned HTTP ${status}`);
        }
        if (error.request) {
          throw new Error('Dolibarr API did not respond');
        }
        throw new Error('Dolibarr API request failed');
      }
    );
  }

  async get<T = unknown>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(endpoint, { params });
    return response.data;
  }

  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(endpoint, data);
    return response.data;
  }

  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(endpoint, data);
    return response.data;
  }

  async patch<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    const response: AxiosResponse<T> = await this.client.patch(endpoint, data);
    return response.data;
  }

  async delete<T = unknown>(endpoint: string): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(endpoint);
    return response.data;
  }
}
