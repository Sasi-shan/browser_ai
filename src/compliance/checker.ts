import { URL } from 'url';
import { logger, StructuredLogger } from '../utils/logger';
import { CacheManager } from '../utils/cache';
import { ComplianceError } from '../types';
import { ConfigManager } from '../config/manager';

export interface ComplianceResult {
  allowed: boolean;
  reason?: string;
  restrictions?: string[];
  rateLimit?: number;
}

export class ComplianceChecker {
  private cache: CacheManager;
  private config: any;

  constructor() {
    this.cache = CacheManager.getInstance();
    this.config = ConfigManager.getInstance().config;
  }

  async checkCompliance(url: string): Promise<ComplianceResult> {
    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;

      // Check cache first
      const cacheKey = `compliance:${domain}`;
      const cached = this.cache.get<ComplianceResult>(cacheKey);
      if (cached) {
        StructuredLogger.logComplianceCheck(url, cached.allowed, 'cached');
        return cached;
      }

      const result: ComplianceResult = {
        allowed: true,
        restrictions: []
      };

      // Check robots.txt if required
      if (this.config.compliance.respectRobotsTxt) {
        const robotsResult = await this.checkRobotsTxt(url);
        if (!robotsResult.allowed) {
          result.allowed = false;
          result.reason = robotsResult.reason;
          result.restrictions?.push('robots.txt');
        }
        if (robotsResult.rateLimit) {
          result.rateLimit = robotsResult.rateLimit;
        }
      }

      // Check domain-specific rules
      const domainResult = this.checkDomainRules(domain);
      if (!domainResult.allowed) {
        result.allowed = false;
        result.reason = domainResult.reason;
        result.restrictions?.push('domain_rules');
      }

      // Check terms of service patterns
      const tosResult = await this.checkTermsOfService(domain);
      if (!tosResult.allowed) {
        result.allowed = false;
        result.reason = tosResult.reason;
        result.restrictions?.push('terms_of_service');
      }

      // Cache the result for 1 hour
      this.cache.set(cacheKey, result, 3600);
      
      StructuredLogger.logComplianceCheck(url, result.allowed, result.reason);
      return result;

    } catch (error) {
      logger.error('Compliance check failed', { url, error });
      throw new ComplianceError(`Compliance check failed for ${url}: ${error}`);
    }
  }

  private async checkRobotsTxt(url: string): Promise<ComplianceResult> {
    try {
      const parsedUrl = new URL(url);
      const robotsUrl = `${parsedUrl.protocol}//${parsedUrl.host}/robots.txt`;

      // Check cache first
      const cacheKey = `robots:${parsedUrl.host}`;
      const cached = this.cache.get<ComplianceResult>(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await fetch(robotsUrl, {
        headers: {
          'User-Agent': this.config.compliance.userAgent
        },
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        // If robots.txt doesn't exist, assume allowed
        const result = { allowed: true };
        this.cache.set(cacheKey, result, 86400); // Cache for 24 hours
        return result;
      }

      const robotsTxt = await response.text();
      const result = this.parseRobotsTxt(robotsTxt, parsedUrl.pathname);
      
      // Cache for 24 hours
      this.cache.set(cacheKey, result, 86400);
      
      return result;

    } catch (error) {
      logger.warn('Failed to fetch robots.txt', { url, error });
      // If we can't fetch robots.txt, assume allowed but log warning
      return { allowed: true };
    }
  }

  private parseRobotsTxt(robotsTxt: string, path: string): ComplianceResult {
    const lines = robotsTxt.split('\n').map(line => line.trim());
    let currentUserAgent = '';
    let applies = false;
    const disallowed: string[] = [];
    let crawlDelay = 0;

    for (const line of lines) {
      if (line.startsWith('#') || !line) continue;

      if (line.toLowerCase().startsWith('user-agent:')) {
        currentUserAgent = line.split(':')[1].trim().toLowerCase();
        applies = currentUserAgent === '*' || 
                 currentUserAgent.includes('leadgenbot') ||
                 currentUserAgent.includes('bot');
      } else if (applies && line.toLowerCase().startsWith('disallow:')) {
        const disallowPath = line.split(':')[1].trim();
        disallowed.push(disallowPath);
      } else if (applies && line.toLowerCase().startsWith('crawl-delay:')) {
        crawlDelay = parseInt(line.split(':')[1].trim()) * 1000; // Convert to milliseconds
      }
    }

    // Check if current path is disallowed
    for (const disallowPath of disallowed) {
      if (disallowPath === '/' || path.startsWith(disallowPath)) {
        return {
          allowed: false,
          reason: `Path ${path} is disallowed by robots.txt`,
          rateLimit: crawlDelay || this.config.compliance.rateLimitDelay
        };
      }
    }

    return {
      allowed: true,
      rateLimit: crawlDelay || this.config.compliance.rateLimitDelay
    };
  }

  private checkDomainRules(domain: string): ComplianceResult {
    // Define domain-specific rules
    const restrictedDomains = [
      'facebook.com',
      'instagram.com',
      'twitter.com',
      'x.com'
    ];

    const linkedinRules = {
      domain: 'linkedin.com',
      maxRequestsPerHour: 50,
      requiredDelay: 3000
    };

    if (restrictedDomains.includes(domain)) {
      return {
        allowed: false,
        reason: `Domain ${domain} is restricted for automated access`
      };
    }

    if (domain.includes('linkedin.com')) {
      return {
        allowed: true,
        rateLimit: linkedinRules.requiredDelay,
        restrictions: [`Max ${linkedinRules.maxRequestsPerHour} requests per hour`]
      };
    }

    return { allowed: true };
  }

  private async checkTermsOfService(domain: string): Promise<ComplianceResult> {
    // This is a simplified version - in production, you'd want more sophisticated ToS checking
    const knownToSViolations = [
      'facebook.com',
      'instagram.com',
      'twitter.com'
    ];

    if (knownToSViolations.includes(domain)) {
      return {
        allowed: false,
        reason: `Terms of Service for ${domain} prohibit automated data collection`
      };
    }

    return { allowed: true };
  }

  async checkRateLimit(domain: string): Promise<{ allowed: boolean; waitTime?: number }> {
    const rateLimitKey = `ratelimit:${domain}`;
    const lastRequest = this.cache.get<number>(rateLimitKey);
    
    if (lastRequest) {
      const timeSinceLastRequest = Date.now() - lastRequest;
      const requiredDelay = this.config.compliance.rateLimitDelay;
      
      if (timeSinceLastRequest < requiredDelay) {
        return {
          allowed: false,
          waitTime: requiredDelay - timeSinceLastRequest
        };
      }
    }

    // Update last request time
    this.cache.set(rateLimitKey, Date.now(), 300); // Cache for 5 minutes
    
    return { allowed: true };
  }

  generateComplianceReport(results: ComplianceResult[]): string {
    const summary = {
      total: results.length,
      allowed: results.filter(r => r.allowed).length,
      blocked: results.filter(r => !r.allowed).length,
      restrictions: results.flatMap(r => r.restrictions || [])
    };

    return `
Compliance Report:
- Total URLs checked: ${summary.total}
- Allowed: ${summary.allowed}
- Blocked: ${summary.blocked}
- Common restrictions: ${[...new Set(summary.restrictions)].join(', ')}
`;
  }
}