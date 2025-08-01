import { StagehandWrapper } from '../stagehand/wrapper';
import { Lead, TaskConfig, LeadGenerationError, LeadSchema } from '../types';
import { logger, StructuredLogger } from '../utils/logger';
import { CacheManager } from '../utils/cache';

export class DirectoryAgent {
  private stagehand: StagehandWrapper;
  private cache: CacheManager;

  // Common business directory URLs
  private readonly directories = {
    yellowPages: 'https://www.yellowpages.com',
    yelp: 'https://www.yelp.com',
    bbb: 'https://www.bbb.org',
    googleMaps: 'https://www.google.com/maps',
    whitepages: 'https://www.whitepages.com',
    localBusiness: 'https://www.superpages.com'
  };

  constructor(stagehand: StagehandWrapper) {
    this.stagehand = stagehand;
    this.cache = CacheManager.getInstance();
  }

  async executeTask(task: TaskConfig): Promise<Lead[]> {
    StructuredLogger.logTaskStart(task.id, 'directory_scan');
    const startTime = Date.now();
    const leads: Lead[] = [];

    try {
      // Determine directory type from target URL
      const directoryType = this.identifyDirectoryType(task.target);
      
      // Navigate to directory
      await this.stagehand.navigateWithCompliance(task.target, task.id);

      // Perform search based on directory type
      let searchResults: any[] = [];
      
      switch (directoryType) {
        case 'yellowPages':
          searchResults = await this.searchYellowPages(task);
          break;
        case 'yelp':
          searchResults = await this.searchYelp(task);
          break;
        case 'googleMaps':
          searchResults = await this.searchGoogleMaps(task);
          break;
        case 'bbb':
          searchResults = await this.searchBBB(task);
          break;
        default:
          searchResults = await this.searchGenericDirectory(task);
      }

      // Extract leads from search results
      for (const result of searchResults) {
        try {
          const lead = await this.extractLeadFromListing(result, task.id, directoryType);
          if (lead) {
            leads.push(lead);
          }
          
          // Rate limiting between extractions
          await this.delay(1500);
        } catch (error) {
          logger.warn('Failed to extract lead from listing', { result, error });
          continue;
        }
      }

      const duration = Date.now() - startTime;
      StructuredLogger.logTaskComplete(task.id, leads.length, duration);
      
      return leads;

    } catch (error) {
      logger.error('Directory task failed', { taskId: task.id, error });
      throw new LeadGenerationError(
        `Directory search failed: ${error}`,
        'DIRECTORY_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private identifyDirectoryType(url: string): string {
    if (url.includes('yellowpages.com')) return 'yellowPages';
    if (url.includes('yelp.com')) return 'yelp';
    if (url.includes('google.com/maps')) return 'googleMaps';
    if (url.includes('bbb.org')) return 'bbb';
    return 'generic';
  }

  private async searchYellowPages(task: TaskConfig): Promise<any[]> {
    try {
      // Enter search query in the search box
      await this.stagehand.stagehand.act({
        instruction: `Find the search box for businesses and type "${task.searchQuery}"`
      });

      await this.delay(1000);

      // Enter location if provided in filters
      if (task.filters?.location) {
        await this.stagehand.stagehand.act({
          instruction: `Add location context: "${task.filters.location}"`
        });
      }

      await this.stagehand.stagehand.act({
        instruction: 'Press Enter to search for businesses'
      });

      await this.delay(3000);

      // Extract Google Maps business listings
      return await this.stagehand.searchWithPagination(
        'Extract business information from Google Maps results including business name, address, phone number, website, hours, and rating',
        Math.ceil(task.maxResults / 20), // Google Maps shows more results per page
        task.id
      );

    } catch (error) {
      throw new LeadGenerationError(
        `Google Maps search failed: ${error}`,
        'GOOGLEMAPS_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async searchBBB(task: TaskConfig): Promise<any[]> {
    try {
      // Search Better Business Bureau directory
      await this.stagehand.stagehand.act({
        instruction: `Find the business search box and type "${task.searchQuery}"`
      });

      await this.delay(1000);

      if (task.filters?.location) {
        await this.stagehand.stagehand.act({
          instruction: `Enter location "${task.filters.location}" in the location field`
        });
      }

      await this.stagehand.stagehand.act({
        instruction: 'Click the search button to find accredited businesses'
      });

      await this.delay(3000);

      // Extract BBB business listings
      return await this.stagehand.searchWithPagination(
        'Extract business information including business name, BBB rating, address, phone number, website, and accreditation status',
        Math.ceil(task.maxResults / 10),
        task.id
      );

    } catch (error) {
      throw new LeadGenerationError(
        `BBB search failed: ${error}`,
        'BBB_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async searchGenericDirectory(task: TaskConfig): Promise<any[]> {
    try {
      // Generic directory search approach
      const searchResults = await this.stagehand.extractWithPreview(
        `Search for businesses matching "${task.searchQuery}" on this directory website. Look for search boxes, category links, or business listings`,
        task.id
      );

      if (searchResults?.searchBoxFound) {
        await this.stagehand.stagehand.act({
          instruction: `Use the search functionality to find "${task.searchQuery}"`
        });

        await this.delay(2000);

        return await this.stagehand.searchWithPagination(
          'Extract all business contact information including names, addresses, phone numbers, emails, and websites',
          Math.ceil(task.maxResults / 10),
          task.id
        );
      } else {
        // If no search box, try to extract existing listings
        const listings = await this.stagehand.extractWithPreview(
          'Extract all visible business listings and contact information from this page',
          task.id
        );

        return listings?.businesses || [];
      }

    } catch (error) {
      throw new LeadGenerationError(
        `Generic directory search failed: ${error}`,
        'GENERIC_DIRECTORY_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async extractLeadFromListing(
    listing: any, 
    taskId: string, 
    directoryType: string
  ): Promise<Lead | null> {
    try {
      // Navigate to business details page if URL is provided
      if (listing.url || listing.detailsUrl) {
        const detailUrl = listing.url || listing.detailsUrl;
        await this.stagehand.navigateWithCompliance(detailUrl, taskId);
        await this.delay(2000);

        // Extract detailed business information
        const detailedInfo = await this.stagehand.extractWithPreview(
          `Extract comprehensive business contact information:
          - Business name
          - Owner/manager name (if available)
          - Email addresses
          - Phone numbers (including mobile if listed)
          - Physical address
          - Website URL
          - Business description
          - Services offered
          - Social media links
          - Business hours
          - Additional contact methods`,
          taskId
        );

        // Merge with original listing data
        listing = { ...listing, ...detailedInfo };
      }

      // Create lead from extracted data
      const lead: Lead = {
        name: this.extractBusinessName(listing),
        email: this.extractEmail(listing),
        phone: this.extractPhone(listing),
        company: listing.businessName || listing.name || listing.company,
        position: listing.ownerTitle || listing.managerTitle || 'Business Owner',
        location: this.extractLocation(listing),
        website: this.extractWebsite(listing),
        source: this.getDirectorySourceName(directoryType),
        extractedAt: new Date(),
        confidence: this.calculateConfidence(listing, directoryType),
        verified: false
      };

      // Validate the lead
      const validatedLead = LeadSchema.parse(lead);
      
      logger.info('Lead extracted from directory listing', { 
        name: validatedLead.name, 
        source: validatedLead.source,
        directory: directoryType
      });

      return validatedLead;

    } catch (error) {
      logger.error('Failed to extract lead from directory listing', { listing, error });
      return null;
    }
  }

  private extractBusinessName(listing: any): string {
    return listing.businessName || 
           listing.name || 
           listing.title || 
           listing.companyName || 
           'Unknown Business';
  }

  private extractEmail(listing: any): string | undefined {
    const emailFields = [
      listing.email,
      listing.contactEmail,
      listing.businessEmail,
      listing.ownerEmail
    ];

    return emailFields.find(email => 
      email && typeof email === 'string' && email.includes('@')
    );
  }

  private extractPhone(listing: any): string | undefined {
    const phoneFields = [
      listing.phone,
      listing.phoneNumber,
      listing.businessPhone,
      listing.contactPhone,
      listing.primaryPhone
    ];

    return phoneFields.find(phone => 
      phone && typeof phone === 'string' && phone.replace(/\D/g, '').length >= 10
    );
  }

  private extractLocation(listing: any): string | undefined {
    if (listing.fullAddress) return listing.fullAddress;
    
    const addressParts = [
      listing.address,
      listing.city,
      listing.state,
      listing.zipCode,
      listing.country
    ].filter(Boolean);

    return addressParts.length > 0 ? addressParts.join(', ') : undefined;
  }

  private extractWebsite(listing: any): string | undefined {
    const websiteFields = [
      listing.website,
      listing.url,
      listing.businessWebsite,
      listing.homepageUrl
    ];

    return websiteFields.find(url => 
      url && typeof url === 'string' && url.startsWith('http')
    );
  }

  private getDirectorySourceName(directoryType: string): string {
    const sourceNames = {
      yellowPages: 'Yellow Pages',
      yelp: 'Yelp',
      googleMaps: 'Google Maps',
      bbb: 'Better Business Bureau',
      generic: 'Business Directory'
    };

    return sourceNames[directoryType] || 'Business Directory';
  }

  private calculateConfidence(listing: any, directoryType: string): number {
    let confidence = 0.6; // Base confidence for directory listings

    // Increase confidence based on available data
    if (this.extractEmail(listing)) confidence += 0.15;
    if (this.extractPhone(listing)) confidence += 0.1;
    if (this.extractWebsite(listing)) confidence += 0.1;
    if (listing.businessDescription) confidence += 0.05;

    // Directory-specific confidence adjustments
    if (directoryType === 'bbb' && listing.accredited) confidence += 0.1;
    if (directoryType === 'yelp' && listing.rating > 4) confidence += 0.05;
    if (directoryType === 'googleMaps' && listing.verified) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  // Specialized search methods
  async searchByCategory(
    category: string, 
    location: string, 
    directoryUrl?: string,
    maxResults: number = 20
  ): Promise<Lead[]> {
    const task: TaskConfig = {
      id: `directory-category-${Date.now()}`,
      type: 'directory_scan',
      target: directoryUrl || this.directories.yellowPages,
      searchQuery: category,
      maxResults,
      filters: { location }
    };

    return this.executeTask(task);
  }

  async searchMultipleDirectories(
    searchQuery: string,
    location: string,
    maxResultsPerDirectory: number = 10
  ): Promise<Lead[]> {
    const allLeads: Lead[] = [];
    const directoriesToSearch = [
      this.directories.yellowPages,
      this.directories.yelp,
      this.directories.googleMaps
    ];

    for (const directoryUrl of directoriesToSearch) {
      try {
        const task: TaskConfig = {
          id: `multi-directory-${Date.now()}-${directoryUrl}`,
          type: 'directory_scan',
          target: directoryUrl,
          searchQuery,
          maxResults: maxResultsPerDirectory,
          filters: { location }
        };

        const leads = await this.executeTask(task);
        allLeads.push(...leads);

        // Delay between directories to avoid overwhelming servers
        await this.delay(5000);

      } catch (error) {
        logger.warn(`Failed to search directory ${directoryUrl}`, { error });
        continue;
      }
    }

    // Remove duplicates based on phone number or email
    return this.removeDuplicateLeads(allLeads);
  }

  private removeDuplicateLeads(leads: Lead[]): Lead[] {
    const seen = new Set<string>();
    const uniqueLeads: Lead[] = [];

    for (const lead of leads) {
      const key = lead.email || lead.phone || `${lead.name}-${lead.company}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueLeads.push(lead);
      }
    }

    return uniqueLeads;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}.filters?.location) {
        await this.stagehand.stagehand.act({
          instruction: `Find the location field and enter "${task.filters.location}"`
        });
      }

      // Click search button
      await this.stagehand.stagehand.act({
        instruction: 'Click the search button to find businesses'
      });

      await this.delay(3000);

      // Extract business listings
      return await this.stagehand.searchWithPagination(
        'Extract all business listings including business names, addresses, phone numbers, and website URLs',
        Math.ceil(task.maxResults / 10), // Assuming 10 results per page
        task.id
      );

    } catch (error) {
      throw new LeadGenerationError(
        `Yellow Pages search failed: ${error}`,
        'YELLOWPAGES_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async searchYelp(task: TaskConfig): Promise<any[]> {
    try {
      // Use Yelp's search functionality
      await this.stagehand.stagehand.act({
        instruction: `Click on the search box and type "${task.searchQuery}"`
      });

      await this.delay(1000);

      if (task.filters?.location) {
        await this.stagehand.stagehand.act({
          instruction: `In the location field, clear and type "${task.filters.location}"`
        });
      }

      await this.stagehand.stagehand.act({
        instruction: 'Press Enter or click the search button'
      });

      await this.delay(3000);

      // Extract Yelp business listings
      return await this.stagehand.searchWithPagination(
        'Extract business information including business name, rating, address, phone number, website, and business category',
        Math.ceil(task.maxResults / 10),
        task.id
      );

    } catch (error) {
      throw new LeadGenerationError(
        `Yelp search failed: ${error}`,
        'YELP_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async searchGoogleMaps(task: TaskConfig): Promise<any[]> {
    try {
      // Search in Google Maps
      await this.stagehand.stagehand.act({
        instruction: `Click on the search box and type "${task.searchQuery}"`
      });

      if (task