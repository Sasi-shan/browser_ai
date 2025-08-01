import { config } from 'dotenv';
import { Config } from '../types';

config();

export class ConfigManager {
  private static instance: ConfigManager;
  private _config: Config;

  private constructor() {
    this._config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): Config {
    const requiredEnvVars = ['OPENAI_API_KEY'];
    
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable ${envVar} is not set`);
      }
    }

    return {
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.1')
      },
      stagehand: {
        logLevel: process.env.STAGEHAND_LOG_LEVEL || 'info',
        headless: process.env.STAGEHAND_HEADLESS === 'true',
        timeout: parseInt(process.env.STAGEHAND_BROWSER_TIMEOUT || '30000')
      },
      compliance: {
        respectRobotsTxt: process.env.RESPECT_ROBOTS_TXT !== 'false',
        userAgent: process.env.USER_AGENT || 'LeadGenBot/1.0 (Compliance Check)',
        rateLimitDelay: parseInt(process.env.RATE_LIMIT_DELAY || '2000')
      },
      output: {
        directory: process.env.OUTPUT_DIR || './output',
        csvFile: process.env.CSV_OUTPUT_FILE || 'leads.csv'
      },
      humanInLoop: {
        requireApproval: process.env.REQUIRE_HUMAN_APPROVAL === 'true',
        autoApprove: process.env.AUTO_APPROVE_PREVIEWS === 'true'
      }
    };
  }

  public get config(): Config {
    return this._config;
  }

  public updateConfig(updates: Partial<Config>): void {
    this._config = { ...this._config, ...updates };
  }

  public validateConfig(): boolean {
    try {
      // Validate OpenAI configuration
      if (!this._config.openai.apiKey) {
        throw new Error('OpenAI API key is required');
      }

      // Validate rate limiting
      if (this._config.compliance.rateLimitDelay < 1000) {
        console.warn('Rate limit delay is less than 1 second, this may cause compliance issues');
      }

      return true;
    } catch (error) {
      console.error('Configuration validation failed:', error);
      return false;
    }
  }
}