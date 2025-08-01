import { StagehandWrapper } from '../stagehand/wrapper';
import { Lead, TaskConfig, LeadGenerationError } from '../types';
import { logger, StructuredLogger } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { z } from 'zod';

export class LinkedInAgent {
  private stagehand: StagehandWrapper;
  private cache: CacheManager;

  constructor(stagehand: StagehandWrapper) {
    this.stagehand = stagehand;
    this.cache = CacheManager.getInstance();
  }

  async executeTask(task: TaskConfig): Promise<Lead[]> {
    StructuredLogger.logTaskStart(task.id, 'linkedin_search');
    const startTime = Date.now();
    const leads: Lead[] = [];

    try {
      // Navigate to LinkedIn (requires compliance check)
      await this.navigateToLinkedIn();

      // Perform search based on task configuration
      const searchResults = await this.performSearch(task);

      // Extract lead information from search results
      for (const result of searchResults) {
        try {
          const lead = await this.extractLeadFromProfile(result, task.id);
          if (lead) {
            leads.push(lead);
          }

          // Respect rate limiting
          await this.delay(3000); // LinkedIn requires higher delays
        } catch (error) {
          logger.warn('Failed to extract lead from profile', { result, error });
          continue;
        }
      }

      const duration = Date.now() - startTime;
      StructuredLogger.logTaskComplete(task.id, leads.length, duration);
      
      return leads;

    } catch (error) {
      logger.error('LinkedIn task failed', { taskId: task.id, error });
      throw new LeadGenerationError(
        `LinkedIn search failed: ${error}`,
        'LINKEDIN_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async navigateToLinkedIn(): Promise<void> {
    try {
      await this.stagehand.navigateWithCompliance('https://www.linkedin.com', 'linkedin-nav');
      
      // Wait for page to fully load
      await this.delay(2000);
      
      logger.info('Successfully navigated to LinkedIn');
    } catch (error) {
      throw new LeadGenerationError(
        'Failed to navigate to LinkedIn',
        'NAVIGATION_ERROR',
        'linkedin-nav',
        error as Error
      );
    }
  }

  private async performSearch(task: TaskConfig): Promise<any[]> {
    if (!task.searchQuery) {
      throw new LeadGenerationError('Search query is required for LinkedIn search', 'INVALID_CONFIG', task.id);
    }

    try {
      // Click on search box and enter query
      await this.stagehand.stagehand.act({
        instruction: `Click on the search box and type "${task.searchQuery}"`
      });

      await this.delay(1000);

      // Press enter or click search
      await this.stagehand.stagehand.act({
        instruction: 'Press Enter or click the search button to execute the search'
      });

      // Wait for search results to load
      await this.delay(3000);

      // Apply filters if specified
      if (task.filters) {
        await this.applySearchFilters(task.filters);
      }

      // Extract search result links
      const searchResults = await this.stagehand.extractWithPreview(
        `Extract all profile links from the search results. Focus on individual LinkedIn profiles, not company pages. Get the full URL for each profile.`,
        task.id
      );

      // Limit results based on maxResults
      const profileUrls = searchResults?.links?.slice(0, task.maxResults) || [];
      
      logger.info(`Found ${profileUrls.length} LinkedIn profiles from search`);
      return profileUrls;

    } catch (error) {
      throw new LeadGenerationError(
        `LinkedIn search failed: ${error}`,
        'SEARCH_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async applySearchFilters(filters: Record<string, any>): Promise<void> {
    try {
      // Click on "All filters" button
      await this.stagehand.stagehand.act({
        instruction: 'Click on the "All filters" or "Filters" button to open filter options'
      });

      await this.delay(1000);

      // Apply location filter
      if (filters.location) {
        await this.stagehand.stagehand.act({
          instruction: `In the location filter section, clear existing location and type "${filters.location}"`
        });
        await this.delay(500);
      }

      // Apply industry filter
      if (filters.industry) {
        await this.stagehand.stagehand.act({
          instruction: `In the industry filter section, select or type "${filters.industry}"`
        });
        await this.delay(500);
      }

      // Apply company filter
      if (filters.company) {
        await this.stagehand.stagehand.act({
          instruction: `In the current company filter section, type "${filters.company}"`
        });
        await this.delay(500);
      }

      // Apply the filters
      await this.stagehand.stagehand.act({
        instruction: 'Click the "Apply" or "Show results" button to apply the selected filters'
      });

      await this.delay(3000); // Wait for filtered results to load

    } catch (error) {
      logger.warn('Failed to apply some search filters', { filters, error });
      // Continue without filters rather than failing the entire task
    }
  }

  private async extractLeadFromProfile(profileUrl: string, taskId: string): Promise<Lead | null> {
    try {
      // Navigate to individual profile
      await this.stagehand.navigateWithCompliance(profileUrl, taskId);

      // Wait for profile to load
      await this.delay(2000);

      // Extract profile information
      const profileData = await this.stagehand.extractWithPreview(
        `Extract comprehensive contact and professional information from this LinkedIn profile:
        - Full name
        - Current job title/position
        - Current company name
        - Location (city, country)
        - Email address (if visible)
        - Phone number (if visible)
        - Profile headline
        - About section summary (first 200 characters)
        - Years of experience or seniority level
        - Industry
        - Education (most recent)
        - Contact information from contact info section`,
        taskId,
        true // Require human approval for profile extraction
      );

      if (!profileData || !profileData.name) {
        logger.warn('No profile data extracted', { profileUrl });
        return null;
      }

      // Create lead object
      const lead: Lead = {
        name: profileData.name,
        email: profileData.email || undefined,
        phone: profileData.phone || undefined,
        company: profileData.company || undefined,
        position: profileData.position || profileData.title || undefined,
        location: profileData.location || undefined,
        linkedin: profileUrl,
        source: 'LinkedIn',
        extractedAt: new Date(),
        confidence: this.calculateConfidence(profileData),
        verified: false
      };

      // Validate the lead
      const validatedLead = LeadSchema.parse(lead);
      logger.info('Lead extracted from LinkedIn profile', { 
        name: validatedLead.name, 
        company: validatedLead.company 
      });

      return validatedLead;

    } catch (error) {
      logger.error('Failed to extract lead from LinkedIn profile', { profileUrl, error });
      return null;
    }
  }

  private calculateConfidence(profileData: any): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on available data
    if (profileData.name) confidence += 0.2;
    if (profileData.email) confidence += 0.1;
    if (profileData.phone) confidence += 0.1;
    if (profileData.company) confidence += 0.1;
    if (profileData.position) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  async searchByCompany(companyName: string, maxResults: number = 10): Promise<Lead[]> {
    const task: TaskConfig = {
      id: `linkedin-company-${Date.now()}`,
      type: 'linkedin_search',
      target: 'https://www.linkedin.com',
      searchQuery: `people at ${companyName}`,
      maxResults,
      filters: {
        company: companyName
      }
    };

    return this.executeTask(task);
  }

  async searchByRole(roleName: string, location?: string, maxResults: number = 10): Promise<Lead[]> {
    const searchQuery = location 
      ? `${roleName} in ${location}`
      : roleName;

    const task: TaskConfig = {
      id: `linkedin-role-${Date.now()}`,
      type: 'linkedin_search',
      target: 'https://www.linkedin.com',
      searchQuery,
      maxResults,
      filters: {
        location: location
      }
    };

    return this.executeTask(task);
  }

  async searchByIndustry(industry: string, location?: string, maxResults: number = 10): Promise<Lead[]> {
    const task: TaskConfig = {
      id: `linkedin-industry-${Date.now()}`,
      type: 'linkedin_search',
      target: 'https://www.linkedin.com',
      searchQuery: `professionals in ${industry}`,
      maxResults,
      filters: {
        industry,
        location
      }
    };

    return this.executeTask(task);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Import LeadSchema from types
import { LeadSchema } from '../types';