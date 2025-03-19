import { DEFAULT_API_ROOT } from '../api/jaeger';

export interface JaegerQuery {
  service?: string;
  operation?: string;
  tags?: string;
  lookback?: string;
  limit?: number;
  minDuration?: string;
  maxDuration?: string;
}

export class AITranslationService {
  private static readonly SYSTEM_PROMPT = `
### Instructions:
Your task is to convert a natural language question into a Jaeger trace search query, formatted as a JSON object that adheres to the following interface:
- **Fields**:
  - service: string (must be one of the available services listed below)
  - operation: string (exact operation name, e.g., "createUser", "/v1/login")
  - tags: string (logfmt format, e.g., "error=true http.status_code=500 http.method=GET")
  - lookback: string (time window, e.g., "1h", "24h", "7d")
  - limit: number (integer, e.g., 100, 20)
  - minDuration: string (e.g., "100ms", "1s", "2m")
  - maxDuration: string (e.g., "5s", "1m", "10m")

### Available Services:
{services}

### Rules:
- Analyze the question carefully, word by word, to map terms to the correct fields.
- Use only the fields listed above; do not invent new fields like "outcome" or "status".
- For tags, use common HTTP or error-related keys (e.g., "error", "http.status_code", "http.method", "http.route") when applicable.
- If a term doesn't clearly map to a field, omit it or include it in "tags" if it fits logfmt format.
- If no limit is specified, default to 100.
- The service field MUST be one of the available services listed above.
- Respond **only with a valid JSON object**—no explanations, comments, or extra text.

### Examples:

#### Input: "What are the slowest traces for the payment service in the last 2 hours?"
#### Output:
{
  "service": "payment",
  "lookback": "2h",
  "minDuration": "1s",
  "limit": 100
}

#### Input: "Show me traces for the auth-service with operation /v1/login over the past 24 hours."
#### Output:
{
  "service": "auth-service",
  "operation": "/v1/login",
  "lookback": "24h",
  "limit": 100
}

#### Input: "Find traces for the order service that failed with status 500 in the last 1 hour."
#### Output:
{
  "service": "order",
  "tags": "error=true http.status_code=500",
  "lookback": "1h",
  "limit": 100
}

#### Input: "What traces in the payment service took between 500ms and 2s in the last 3 days?"
#### Output:
{
  "service": "payment",
  "lookback": "3d",
  "minDuration": "500ms",
  "maxDuration": "2s",
  "limit": 100
}

#### Input: "Show traces for the checkout service with GET requests that failed yesterday."
#### Output:
{
  "service": "checkout",
  "tags": "http.method=GET error=true",
  "lookback": "24h",
  "limit": 100
}

#### Input: "Give me the 50 slowest traces for the boatcruize-backend service."
#### Output:
{
  "service": "boatcruize-backend",
  "minDuration": "1s",
  "limit": 50
}

### Input:
"{query}"
### Output:
`;

  private endpoint: string;
  private healthEndpoint: string;
  private services: string[] = [];

  constructor() {
    this.endpoint = 'http://localhost:11434/api/generate';
    this.healthEndpoint = 'http://localhost:11434/api/version';
  }

  async fetchServices(): Promise<string[]> {
    try {
      const response = await fetch(`${DEFAULT_API_ROOT}services`);
      if (!response.ok) {
        throw new Error(`Failed to fetch services: ${response.statusText}`);
      }
      const data = await response.json();
      this.services = data.data || [];
      return this.services;
    } catch (error) {
      console.error('Failed to fetch services:', error);
      throw new Error('Failed to fetch available services. Please try again later.');
    }
  }

  async translateQuery(query: string): Promise<JaegerQuery> {
    console.log('Starting translation for query:', query);
    try {
      // Health check
      try {
        const healthCheck = await fetch(this.healthEndpoint, { 
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        if (!healthCheck.ok) {
          throw new Error(`Ollama service returned status ${healthCheck.status}`);
        }
      } catch (error) {
        throw new Error(
          'Ollama service is not available. Please ensure Ollama is installed and running on port 11434. ' +
          'Visit https://ollama.ai for installation instructions.'
        );
      }

      // Fetch services if not already loaded
      if (this.services.length === 0) {
        await this.fetchServices();
      }

      const requestBody = {
        model: 'llama3.1',
        prompt: AITranslationService.SYSTEM_PROMPT
          .replace('{services}', this.services.join(', '))
          .replace('{query}', query),
        stream: false,
      };
      console.log('Request body:', requestBody);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Raw response data:', data);

      const result = JSON.parse(data.response);
      console.log('Parsed result:', result);

      return this.validateQuery(result);
    } catch (error) {
      console.error('AI translation failed:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private validateQuery(query: JaegerQuery): JaegerQuery {
    // Ensure all values are of correct type and format
    if (query.limit && typeof query.limit !== 'number') {
      query.limit = parseInt(query.limit as any, 10) || 100;
    }
    if (!query.limit) {
      query.limit = 100;
    }

    // Validate service exists
    if (query.service && !this.services.includes(query.service)) {
      throw new Error(`Invalid service "${query.service}". Available services are: ${this.services.join(', ')}`);
    }

    // Validate lookback format (e.g., "1h", "24h", "7d")
    if (query.lookback && !/^\d+[hdms]$/.test(query.lookback)) {
      query.lookback = '1h';
    }

    // Validate duration formats
    const durationRegex = /^\d+(\.\d+)?[hdms]$/;
    if (query.minDuration && !durationRegex.test(query.minDuration)) {
      delete query.minDuration;
    }
    if (query.maxDuration && !durationRegex.test(query.maxDuration)) {
      delete query.maxDuration;
    }

    // Validate tags are in logfmt format
    if (query.tags) {
      const tagPairs = query.tags.split(' ');
      const validTags = tagPairs.filter(pair => {
        const [key, value] = pair.split('=');
        return key && value && /^[a-zA-Z0-9._-]+=/.test(pair);
      });
      query.tags = validTags.join(' ') || undefined;
    }

    return query;
  }
}

export const aiTranslationService = new AITranslationService();