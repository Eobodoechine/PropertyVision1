// Web search integration service - no hardcoded data
export class WebSearchIntegration {

  async searchProperty(address: string): Promise<any> {
    console.log(`🔍 WEB SEARCH INTEGRATION: ${address}`);
    console.log(`🚫 No hardcoded data - external API integration required`);

    // All property data must come from external APIs
    return null;
  }

  async enrichPropertyData(address: string, existingData: any): Promise<any> {
    console.log(`🔍 PROPERTY ENRICHMENT: ${address}`);
    console.log(`🚫 No hardcoded data - external API integration required`);

    // Return existing data unchanged - no hardcoded enrichment
    return existingData;
  }

  async performWebSearch(query: string): Promise<any[]> {
    console.log(`🌐 WEB SEARCH: ${query}`);
    console.log(`🚫 No hardcoded data - external web search API integration required`);

    // Return empty results - external API required
    return [];
  }
}

export const webSearchIntegration = new WebSearchIntegration();
export default webSearchIntegration;