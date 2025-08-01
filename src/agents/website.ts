import { StagehandWrapper } from '../stagehand/wrapper';
import { Lead, TaskConfig, LeadGenerationError, LeadSchema } from '../types';
import { logger, StructuredLogger } from '../utils/logger';
import { CacheManager } from '../utils/cache';

export class WebsiteAgent {
  private stagehand: StagehandWrapper;
  private cache: CacheManager;

  constructor(stagehand: StagehandWrapper) {
    this.stagehand = stagehand;
    this.cache = CacheManager.getInstance();
  }

  async executeTask(task: TaskConfig): Promise<Lead[]> {
    StructuredLogger.logTaskStart(task.id, 'website_extraction');
    const startTime = Date.now();
    const leads: Lead[] = [];

    try {
      // Navigate to target website
      await this.stagehand.navigateWithCompliance(task.target, task.id);

      // Identify website type and extraction strategy
      const websiteType = await this.identifyWebsiteType();
      logger.info('Website type identified', { type: websiteType, url: task.target });

      // Extract leads based on website type
      let extractedLeads: Lead[] = [];

      switch (websiteType) {
        case 'corporate':
          extractedLeads = await this.extractFromCorporateWebsite(task);
          break;
        case 'ecommerce':
          extractedLeads = await this.extractFromEcommerceWebsite(task);
          break;
        case 'blog':
          extractedLeads = await this.extractFromBlogWebsite(task);
          break;
        case 'portfolio':
          extractedLeads = await this.extractFromPortfolioWebsite(task);
          break;
        case 'directory':
          extractedLeads = await this.extractFromDirectoryWebsite(task);
          break;
        default:
          extractedLeads = await this.extractFromGenericWebsite(task);
      }

      leads.push(...extractedLeads);

      const duration = Date.now() - startTime;
      StructuredLogger.logTaskComplete(task.id, leads.length, duration);
      
      return leads;

    } catch (error) {
      logger.error('Website extraction task failed', { taskId: task.id, error });
      throw new LeadGenerationError(
        `Website extraction failed: ${error}`,
        'WEBSITE_ERROR',
        task.id,
        error as Error
      );
    }
  }

  private async identifyWebsiteType(): Promise<string> {
    try {
      const pageAnalysis = await this.stagehand.extractWithPreview(
        'Analyze this webpage to determine its type. Look for: corporate about pages, team sections, e-commerce features, blog posts, portfolio items, or directory listings. Return the primary website type.',
        'website-analysis'
      );

      const pageContent = await this.stagehand.stagehand.page.content();
      
      // Analyze page structure and content
      if (pageContent.includes('team') || pageContent.includes('about') || pageContent.includes('leadership')) {
        return 'corporate';
      }
      if (pageContent.includes('cart') || pageContent.includes('shop') || pageContent.includes('product')) {
        return 'ecommerce';
      }
      if (pageContent.includes('blog') || pageContent.includes('article') || pageContent.includes('post')) {
        return 'blog';
      }
      if (pageContent.includes('portfolio') || pageContent.includes('work') || pageContent.includes('project')) {
        return 'portfolio';
      }
      if (pageContent.includes('directory') || pageContent.includes('listing') || pageContent.includes('member')) {
        return 'directory';
      }

      return 'generic';

    } catch (error) {
      logger.warn('Failed to identify website type, using generic approach', { error });
      return 'generic';
    }
  }

  private async extractFromCorporateWebsite(task: TaskConfig): Promise<Lead[]> {
    const leads: Lead[] = [];

    try {
      // Look for team/about pages
      const teamPageFound = await this.navigateToTeamPage();
      
      if (teamPageFound) {
        const teamMembers = await this.stagehand.extractWithPreview(
          `Extract information about all team members from this page:
          - Full names
          - Job titles/positions
          - Email addresses (if visible)
          - Phone numbers (if visible)
          - LinkedIn profile links
          - Bio information
          - Department/division`,
          task.id,
          true
        );

        if (teamMembers?.members) {
          for (const member of teamMembers.members) {
            const lead = await this.createLeadFromTeamMember(member, task.target);
            if (lead) leads.push(lead);
          }
        }
      }

      // Extract contact information from contact page
      const contactInfo = await this.extractContactPageInfo(task);
      if (contactInfo) {
        leads.push(...contactInfo);
      }

      // Look for leadership/executive information
      const leadershipInfo = await this.extractLeadershipInfo(task);
      if (leadershipInfo) {
        leads.push(...leadershipInfo);
      }

      return leads;

    } catch (error) {
      logger.error('Corporate website extraction failed', { error });
      return [];
    }
  }

  private async navigateToTeamPage(): Promise<boolean> {
    try {
      const teamPageSelectors = [
        'a[href*="team"]',
        'a[href*="about"]',
        'a[href*="staff"]',
        'a[href*="people"]',
        'a:contains("Team")',
        'a:contains("About Us")',
        'a:contains("Our Team")'
      ];

      for (const selector of teamPageSelectors) {
        try {
          const element = await this.stagehand.stagehand.page.$(selector.replace(':contains', ''));
          if (element) {
            await this.stagehand.stagehand.act({
              instruction: `Click on the team or about page link`
            });
            await this.delay(2000);
            return true;
          }
        } catch (error) {
          continue;
        }
      }

      return false;
    } catch (error) {
      logger.warn('Failed to navigate to team page', { error });
      return false;
    }
  }

  private async extractContactPageInfo(task: TaskConfig): Promise<Lead[]> {
    try {
      // Try to navigate to contact page
      await this.stagehand.stagehand.act({
        instruction: 'Look for and click on a "Contact" or "Contact Us" link'
      });

      await this.delay(2000);

      const contactInfo = await this.stagehand.extractWithPreview(
        `Extract all contact information from this contact page:
        - Contact person names
        - Email addresses
        - Phone numbers
        - Physical addresses
        - Contact form information
        - Department-specific contacts`,
        task.id
      );

      if (contactInfo?.contacts) {
        return contactInfo.contacts.map((contact: any) => this.createLeadFromContact(contact, task.target));
      }

      return [];

    } catch (error) {
      logger.warn('Failed to extract contact page info', { error });
      return [];
    }
  }

  private async extractLeadershipInfo(task: TaskConfig): Promise<Lead[]> {
    try {
      const leadershipInfo = await this.stagehand.extractWithPreview(
        `Look for executive or leadership information on this website:
        - CEO, CTO, CFO names and contact info
        - Department heads
        - Senior management team
        - Board members
        - Key personnel contact details`,
        task.id
      );

      if (leadershipInfo?.leaders) {
        return leadershipInfo.leaders.map((leader: any) => this.createLeadFromLeader(leader, task.target));
      }

      return [];

    } catch (error) {
      logger.warn('Failed to extract leadership info', { error });
      return [];
    }
  }

  private async extractFromEcommerceWebsite(task: TaskConfig): Promise<Lead[]> {
    try {
      // Extract business owner/contact information
      const businessInfo = await this.stagehand.extractWithPreview(
        `Extract business owner and contact information from this e-commerce website:
        - Store owner/manager information
        - Customer service contacts
        - Business registration details
        - Support team information
        - Vendor/supplier contacts if visible`,
        task.id
      );

      return this.processBusinessInfo(businessInfo, task.target);

    } catch (error) {
      logger.error('E-commerce website extraction failed', { error });
      return [];
    }
  }

  private async extractFromBlogWebsite(task: TaskConfig): Promise<Lead[]> {
    try {
      // Extract author information
      const authorInfo = await this.stagehand.extractWithPreview(
        `Extract author and contributor information from this blog:
        - Author names and bio information
        - Contact details in author profiles
        - About page information
        - Guest contributor details
        - Social media links`,
        task.id
      );

      return this.processAuthorInfo(authorInfo, task.target);

    } catch (error) {
      logger.error('Blog website extraction failed', { error });
      return [];
    }
  }

  private async extractFromPortfolioWebsite(task: TaskConfig): Promise<Lead[]> {
    try {
      const portfolioInfo = await this.stagehand.extractWithPreview(
        `Extract professional contact information from this portfolio website:
        - Portfolio owner name and contact details
        - Professional background
        - Client testimonials with contact info
        - Collaborator information
        - Contact forms and social links`,
        task.id
      );

      return this.processPortfolioInfo(portfolioInfo, task.target);

    } catch (error) {
      logger.error('Portfolio website extraction failed', { error });
      return [];
    }
  }

  private async extractFromDirectoryWebsite(task: TaskConfig): Promise<Lead[]> {
    try {
      return await this.stagehand.searchWithPagination(
        'Extract all professional listings from this directory including names, contact information, business details, and professional qualifications',
        Math.ceil(task.maxResults / 10),
        task.id
      );

    } catch (error) {
      logger.error('Directory website extraction failed', { error });
      return [];
    }
  }

  private async extractFromGenericWebsite(task: TaskConfig): Promise<Lead[]> {
    try {
      const genericInfo = await this.stagehand.extractWithPreview(
        `Extract any available contact information from this website:
        - Names of people mentioned
        - Email addresses
        - Phone numbers
        - Professional titles and roles
        - Company information
        - Social media profiles
        - Any form of contact details`,
        task.id
      );

      return this.processGenericInfo(genericInfo, task.target);

    } catch (error) {
      logger.error('Generic website extraction failed', { error });
      return [];
    }
  }

  private async createLeadFromTeamMember(member: any, sourceUrl: string): Promise<Lead | null> {
    try {
      const lead: Lead = {
        name: member.name || member.fullName,
        email: member.email,
        phone: member.phone,
        company: await this.extractCompanyName(sourceUrl),
        position: member.position || member.title || member.role,
        location: member.location,
        linkedin: member.linkedin || member.linkedinUrl,
        website: sourceUrl,
        source: 'Corporate Website',
        extractedAt: new Date(),
        confidence: this.calculateWebsiteConfidence(member, 'team'),
        verified: false
      };

      return LeadSchema.parse(lead);
    } catch (error) {
      logger.warn('Failed to create lead from team member', { member, error });
      return null;
    }
  }

  private createLeadFromContact(contact: any, sourceUrl: string): Lead {
    return {
      name: contact.name || contact.contactName || 'Contact Person',
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      position: contact.position || 'Contact',
      location: contact.address || contact.location,
      website: sourceUrl,
      source: 'Website Contact',
      extractedAt: new Date(),
      confidence: this.calculateWebsiteConfidence(contact, 'contact'),
      verified: false
    };
  }

  private createLeadFromLeader(leader: any, sourceUrl: string): Lead {
    return {
      name: leader.name,
      email: leader.email,
      phone: leader.phone,
      company: leader.company,
      position: leader.position || leader.title,
      location: leader.location,
      linkedin: leader.linkedin,
      website: sourceUrl,
      source: 'Executive Profile',
      extractedAt: new Date(),
      confidence: this.calculateWebsiteConfidence(leader, 'leadership'),
      verified: false
    };
  }

  private processBusinessInfo(businessInfo: any, sourceUrl: string): Lead[] {
    // Process e-commerce business information
    return (businessInfo?.contacts || []).map((contact: any) => this.createLeadFromContact(contact, sourceUrl));
  }

  private processAuthorInfo(authorInfo: any, sourceUrl: string): Lead[] {
    // Process blog author information
    return (authorInfo?.authors || []).map((author: any) => ({
      name: author.name,
      email: author.email,
      phone: author.phone,
      company: author.publication || 'Independent Author',
      position: 'Author/Writer',
      location: author.location,
      website: sourceUrl,
      source: 'Blog Author',
      extractedAt: new Date(),
      confidence: this.calculateWebsiteConfidence(author, 'author'),
      verified: false
    }));
  }

  private processPortfolioInfo(portfolioInfo: any, sourceUrl: string): Lead[] {
    // Process portfolio information
    const leads: Lead[] = [];
    
    if (portfolioInfo?.owner) {
      leads.push({
        name: portfolioInfo.owner.name,
        email: portfolioInfo.owner.email,
        phone: portfolioInfo.owner.phone,
        company: portfolioInfo.owner.company || 'Freelancer',
        position: portfolioInfo.owner.profession || 'Professional',
        location: portfolioInfo.owner.location,
        website: sourceUrl,
        source: 'Portfolio Website',
        extractedAt: new Date(),
        confidence: this.calculateWebsiteConfidence(portfolioInfo.owner, 'portfolio'),
        verified: false
      });
    }

    return leads;
  }

  private processGenericInfo(genericInfo: any, sourceUrl: string): Lead[] {
    // Process generic website information
    return (genericInfo?.contacts || []).map((contact: any) => this.createLeadFromContact(contact, sourceUrl));
  }

  private async extractCompanyName(url: string): Promise<string> {
    try {
      const pageTitle = await this.stagehand.stagehand.page.title();
      const domain = new URL(url).hostname.replace('www.', '');
      
      // Try to extract company name from title or domain
      return pageTitle.split(' - ')[0] || domain.split('.')[0];
    } catch (error) {
      return 'Unknown Company';
    }
  }

  private calculateWebsiteConfidence(data: any, context: string): number {
    let confidence = 0.4; // Base confidence for website extraction

    // Increase based on available data
    if (data.name) confidence += 0.2;
    if (data.email) confidence += 0.2;
    if (data.phone) confidence += 0.1;
    if (data.position || data.title) confidence += 0.1;

    // Context-specific adjustments
    if (context === 'leadership') confidence += 0.1;
    if (context === 'team') confidence += 0.05;

    return Math.min(confidence, 1.0);
  }

  // Utility method for bulk website extraction
  async extractFromMultiplePages(
    urls: string[],
    maxResultsPerPage: number = 10
  ): Promise<Lead[]> {
    const allLeads: Lead[] = [];

    for (const url of urls) {
      try {
        const task: TaskConfig = {
          id: `website-bulk-${Date.now()}-${url}`,
          type: 'website_extraction',
          target: url,
          maxResults: maxResultsPerPage
        };

        const leads = await this.executeTask(task);
        allLeads.push(...leads);

        // Delay between websites
        await this.delay(3000);

      } catch (error) {
        logger.warn(`Failed to extract from website ${url}`, { error });
        continue;
      }
    }

    return allLeads;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}