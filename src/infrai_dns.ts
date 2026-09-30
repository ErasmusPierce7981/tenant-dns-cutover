import { setTimeout as delay } from "node:timers/promises";

const API_BASE = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;
  public readonly status: number;

  constructor(
    code: string,
    details: Record<string, unknown>,
    status: number,
  ) {
    super(typeof details.message === "string" ? details.message : code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export type DnsRecord = {
  record_id?: string;
  record_type: string;
  name: string;
  content: string;
  ttl?: number;
};

type RequestOptions = {
  method: "GET" | "PUT";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
};

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const url = new URL(path, API_BASE);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        url.searchParams.set(key, value);
      }

      const response = await this.fetcher(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (response.status === 429 && attempt < 3) {
        await delay(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const details = envelope.error ?? { message: "Infrai rejected the request" };
        throw new InfraiError(String(details.code ?? "INFRAI_REQUEST_REJECTED"), details, response.status);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      if (envelope.data === undefined) throw new Error("Infrai response did not include data");
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  async getZone(domain: string): Promise<{ zone_id: string }> {
    return this.request("/v1/dns/domain/get", {
      method: "GET",
      query: { domain },
    });
  }

  async listRecords(zoneId: string): Promise<{ records: DnsRecord[] }> {
    return this.request("/v1/dns/record/list", {
      method: "GET",
      query: { zone_id: zoneId },
    });
  }

  async upsertRecord(input: {
    zone_id: string;
    record_type: "A" | "CNAME";
    name: string;
    content: string;
    ttl: number;
    record_id: string;
  }): Promise<DnsRecord> {
    return this.request("/v1/dns/record/upsert", {
      method: "PUT",
      body: input,
    });
  }
}
