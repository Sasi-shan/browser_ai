import { Stagehand } from '@browserbasehq/stagehand';
import { logger, StructuredLogger } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { ComplianceChecker } from '../compliance/checker';
import { ConfigManager } from '../config/manager';
import { ActionPreview, EvaluationMetrics } from '../types';
import { z } from 'zod';

export class StagehandWrapper {
  private stagehand: Stagehand;
  private cache: CacheManager;
  private compliance: ComplianceChecker;
  private config: any;
  private metrics: Map<string, EvaluationMetrics> = new Map();

  constructor() {
    this.cache = CacheManager.getInstance();
    this.compliance = new ComplianceChecker();
    this.config = ConfigManager.getInstance().config;
  }

  async initialize(): Promise<void> {
    try {
      this.stagehand = new Stagehand({
        env: 'LOCAL',
        headless: this.config.stagehand.headless,
        logger: (message: string, level: string) => {
          logger.log(level as any, `Stagehand: ${message}`);
        },
        enableCaching: true,
        modelName: this.config.openai.model,
        modelClientOptions: {
          apiKey: this.config.openai.apiKey,
        }
      });

      await this.stagehand.init();
      logger.info('Stagehand initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Stagehand', { error });
      throw error;
    }
  }

  async navigateWithCompliance(url: string, taskId: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Check compliance first
      const complianceResult = await this.compliance.checkCompliance(url);
      if (!complianceResult.allowed) {
        throw new Error(`Compliance check failed: ${complianceResult.reason}`);
      }

      // Check rate limiting
      const domain = new URL(url).hostname;
      const rateLimitResult = await this.compliance.checkRateLimit(domain);
      if (!rateLimitResult.allowed && rateLimitResult.waitTime) {
        logger.info(`Rate limit delay required: ${rateLimitResult.waitTime}ms`);
        await this.delay(rateLimitResult.waitTime);
      }

      // Check cache first
      const cacheKey = `page:${url}`;
      const cachedPage = this.cache.getCachedPageData(url);
      if (cachedPage) {
        logger.info('Using cached page data', { url });
        return;
      }

      // Navigate to page
      await this.stagehand.page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: this.config.stagehand.timeout 
      });

      // Cache page metadata
      const pageTitle = await this.stagehand.page.title();
      this.cache.cachePageData(url, { title: pageTitle, timestamp: Date.now() });

      this.updateMetrics(taskId, 'navigation', Date.now() - startTime);
      logger.info('Successfully navigated to page', { url, title: pageTitle });

    } catch (error) {
      this.updateMetrics(taskId, 'navigation_error', Date.now() - startTime);
      logger.error('Navigation failed', { url, error });
      throw error;
    }
  }

  async extractWithPreview(
    extractionPrompt: string,
    taskId: string,
    requireHumanApproval: boolean = false
  ): Promise<any> {
    const startTime = Date.now();
    
    try {
      // Generate action preview
      const preview = await this.generateActionPreview(extractionPrompt);
      
      if (requireHumanApproval) {
        const approved = await this.requestHumanApproval(preview);
        if (!approved) {
          throw new Error('Human approval denied for extraction action');
        }
      }

      // Check cache for similar extraction
      const cacheKey = `extraction:${this.hashPrompt(extractionPrompt)}:${await this.getCurrentPageUrl()}`;
      const cached = this.cache.getCachedStagehandAction(cacheKey);
      if (cached) {
        logger.info('Using cached extraction result');
        return cached;
      }

      // Perform extraction using Stagehand
      const result = await this.stagehand.extract({
        instruction: extractionPrompt,
        schema: z.object({
          leads: z.array(z.object({
            name: z.string().optional(),
            email: z.string().optional(),
            phone: z.string().optional(),
            company: z.string().optional(),
            position: z.string().optional(),
            linkedin: z.string().optional(),
            location: z.string().optional()
          }))
        })
      });

      // Cache the result
      this.cache.cacheStagehandAction(cacheKey, result, 1800); // 30 minutes

      this.updateMetrics(taskId, 'extraction', Date.now() - startTime, result?.leads?.length || 0);
      StructuredLogger.logLLMCall(this.config.openai.model, this.estimateTokens(extractionPrompt));

      return result;

    } catch (error) {
      this.updateMetrics(taskId, 'extraction_error', Date.now() - startTime);
      logger.error('Extraction failed', { extractionPrompt, error });
      throw error;
    }
  }

  async observeForm(selector: string): Promise<any> {
    try {
      // Use Stagehand's observe method to get entire form values
      const formData = await this.stagehand.observe({
        instruction: `Get all form field values from the form matching selector: ${selector}`,
        useTextExtract: true
      });

      logger.info('Form observed successfully', { selector, fieldsFound: Object.keys(formData || {}).length });
      return formData;

    } catch (error) {
      logger.error('Form observation failed', { selector, error });
      throw error;
    }
  }

  async fillFormWithValidation(
    formData: Record<string, string>,
    taskId: string
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Generate preview for form filling
      const preview = await this.generateFormFillPreview(formData);
      
      if (this.config.humanInLoop.requireApproval) {
        const approved = await this.requestHumanApproval(preview);
        if (!approved) {
          throw new Error('Human approval denied for form filling');
        }
      }

      // Fill form using Stagehand
      for (const [field, value] of Object.entries(formData)) {
        await this.stagehand.act({
          instruction: `Fill the field "${field}" with value "${value}"`
        });
        
        // Small delay between field fills
        await this.delay(500);
      }

      this.updateMetrics(taskId, 'form_fill', Date.now() - startTime);
      logger.info('Form filled successfully', { fieldsCount: Object.keys(formData).length });

    } catch (error) {
      this.updateMetrics(taskId, 'form_fill_error', Date.now() - startTime);
      logger.error('Form filling failed', { formData, error });
      throw error;
    }
  }

  async searchWithPagination(
    searchQuery: string,
    maxPages: number,
    taskId: string
  ): Promise<any[]> {
    const results: any[] = [];
    let currentPage = 1;

    try {
      while (currentPage <= maxPages) {
        logger.info(`Processing page ${currentPage} of search results`);

        // Extract results from current page
        const pageResults = await this.extractWithPreview(
          `Extract all contact information from this page including names, emails, phone numbers, companies, and positions. Focus on professional profiles and business listings.`,
          taskId
        );

        if (pageResults?.leads) {
          results.push(...pageResults.leads);
        }

        // Try to navigate to next page
        const hasNextPage = await this.navigateToNextPage();
        if (!hasNextPage) {
          logger.info('No more pages available');
          break;
        }

        currentPage++;
        
        // Rate limiting between pages
        await this.delay(this.config.compliance.rateLimitDelay);
      }

      logger.info(`Search completed: ${results.length} leads found across ${currentPage - 1} pages`);
      return results;

    } catch (error) {
      logger.error('Search with pagination failed', { searchQuery, currentPage, error });
      throw error;
    }
  }

  private async navigateToNextPage(): Promise<boolean> {
    try {
      // Try common next page patterns
      const nextPageSelectors = [
        'a[aria-label="Next"]',
        'a.next',
        'button:has-text("Next")',
        '.pagination .next',
        '[data-testid="next-page"]'
      ];

      for (const selector of nextPageSelectors) {
        try {
          const element = await this.stagehand.page.$(selector);
          if (element) {
            await this.stagehand.act({
              instruction: `Click the next page button or link`
            });
            
            // Wait for page to load
            await this.stagehand.page.waitForLoadState('networkidle');
            return true;
          }
        } catch (error) {
          // Continue to next selector
          continue;
        }
      }

      return false;
    } catch (error) {
      logger.warn('Failed to navigate to next page', { error });
      return false;
    }
  }

  private async generateActionPreview(instruction: string): Promise<ActionPreview> {
    const currentUrl = await this.getCurrentPageUrl();
    
    return {
      action: 'extract',
      target: currentUrl,
      description: `Extract data using instruction: ${instruction}`,
      riskLevel: this.assessRiskLevel(instruction),
      compliance: {
        termsOfService: true, // Would be checked against known ToS violations
        robotsTxt: true,     // Already checked in navigation
        rateLimit: true      // Rate limiting applied
      }
    };
  }

  private async generateFormFillPreview(formData: Record<string, string>): Promise<ActionPreview> {
    const currentUrl = await this.getCurrentPageUrl();
    
    return {
      action: 'form_fill',
      target: currentUrl,
      description: `Fill form with ${Object.keys(formData).length} fields`,
      riskLevel: 'medium',
      compliance: {
        termsOfService: true,
        robotsTxt: true,
        rateLimit: true
      }
    };
  }

  private async requestHumanApproval(preview: ActionPreview): Promise<boolean> {
    if (this.config.humanInLoop.autoApprove && preview.riskLevel === 'low') {
      return true;
    }

    // In a real implementation, this would show a UI or prompt
    logger.info('Human approval required', preview);
    
    // For demo purposes, auto-approve low risk actions
    const approved = preview.riskLevel === 'low';
    StructuredLogger.logHumanInteraction(preview.action, approved);
    
    return approved;
  }

  private assessRiskLevel(instruction: string): 'low' | 'medium' | 'high' {
    const highRiskKeywords = ['login', 'password', 'credit card', 'payment'];
    const mediumRiskKeywords = ['submit', 'send', 'post', 'create'];
    
    const lowerInstruction = instruction.toLowerCase();
    
    if (highRiskKeywords.some(keyword => lowerInstruction.includes(keyword))) {
      return 'high';
    }
    
    if (mediumRiskKeywords.some(keyword => lowerInstruction.includes(keyword))) {
      return 'medium';
    }
    
    return 'low';
  }

  private async getCurrentPageUrl(): Promise<string> {
    return await this.stagehand.page.url();
  }

  private hashPrompt(prompt: string): string {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      const char = prompt.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private updateMetrics(
    taskId: string, 
    operation: string, 
    duration: number, 
    leadsCount: number = 0
  ): void {
    const existing = this.metrics.get(taskId) || {
      taskId,
      llmCallsCount: 0,
      tokensUsed: 0,
      executionTime: 0,
      successRate: 0,
      leadsExtracted: 0,
      complianceScore: 1.0
    };

    existing.executionTime += duration;
    if (operation.includes('error')) {
      existing.successRate = Math.max(0, existing.successRate - 0.1);
    } else {
      existing.successRate = Math.min(1, existing.successRate + 0.1);
    }
    existing.leadsExtracted += leadsCount;

    this.metrics.set(taskId, existing);
  }

  getMetrics(taskId: string): EvaluationMetrics | undefined {
    return this.metrics.get(taskId);
  }

  getAllMetrics(): EvaluationMetrics[] {
    return Array.from(this.metrics.values());
  }

  async cleanup(): Promise<void> {
    try {
      if (this.stagehand) {
        await this.stagehand.close();
        logger.info('Stagehand cleanup completed');
      }
    } catch (error) {
      logger.error('Stagehand cleanup failed', { error });
    }
  }
}