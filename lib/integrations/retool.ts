export class RetoolService {
  private apiKey: string;
  private workflowUrl: string;

  constructor(apiKey: string, workflowUrl: string) {
    this.apiKey = apiKey;
    this.workflowUrl = (workflowUrl || '').trim();
  }

  /**
   * Fetch customer data from a Retool Workflow.
   *
   * Retool Workflows are exposed via a webhook/API trigger URL and are
   * authenticated with the `X-Workflow-Api-Key` header. We POST the customer
   * email in the JSON body; the workflow is expected to look up the customer
   * and return their data.
   *
   * Workflows triggered through the public Retool API wrap the result in a
   * top-level `{ data: ... }` envelope, while self-hosted webhook responses
   * return the raw body. We unwrap the former so the UI/AI always sees the
   * actual customer data.
   */
  async getCustomerContext(email: string) {
    if (!this.workflowUrl) {
      console.error('Retool: missing workflow URL — cannot fetch customer context');
      return null;
    }

    try {
      const response = await fetch(this.workflowUrl, {
        method: 'POST',
        headers: {
          'X-Workflow-Api-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const bodySnippet = (await response.text().catch(() => '')).slice(0, 200);
        console.error(
          `Retool workflow error: HTTP ${response.status}${bodySnippet ? ` — ${bodySnippet}` : ''}`
        );
        return null;
      }

      const json = await response.json().catch(() => null);
      if (json == null) return null;

      // Unwrap the `{ data: ... }` envelope used by the public API trigger.
      const data =
        json && typeof json === 'object' && 'data' in json
          ? (json as { data: unknown }).data
          : json;

      // Treat an empty result as "no customer found" so we don't render an
      // empty Retool card / feed nothing useful to the AI.
      if (
        data == null ||
        (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) ||
        (Array.isArray(data) && data.length === 0)
      ) {
        return null;
      }

      return { data };
    } catch (error) {
      console.error('Error fetching Retool context:', error);
      return null;
    }
  }
}
