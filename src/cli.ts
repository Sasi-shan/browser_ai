import inquirer from 'inquirer';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import { LeadGenerationCoordinator } from './agents/coordinator';
import { OutputManager } from './output/manager';
import { ConfigManager } from './config/manager';
import { logger } from './utils/logger';
import { TaskConfig, Lead } from './types';

export class CLIInterface {
  private coordinator: LeadGenerationCoordinator;
  private outputManager: OutputManager;
  private config: any;

  constructor() {
    this.coordinator = new LeadGenerationCoordinator();
    this.outputManager = new OutputManager();
    this.config = ConfigManager.getInstance().config;
  }

  async start(): Promise<void> {
    try {
      console.log(chalk.blue.bold('🚀 Lead Generation System'));
      console.log(chalk.gray('Powered by Stagehand and LangGraph\n'));

      // Initialize the system
      console.log(chalk.yellow('Initializing system...'));
      await this.coordinator.initialize();
      console.log(chalk.green('✅ System initialized\n'));

      // Main menu loop
      let running = true;
      while (running) {
        const action = await this.showMainMenu();
        
        switch (action) {
          case 'quick_search':
            await this.quickSearch();
            break;
          case 'advanced_search':
            await this.advancedSearch();
            break;
          case 'bulk_search':
            await this.bulkSearch();
            break;
          case 'view_config':
            await this.viewConfiguration();
            break;
          case 'view_metrics':
            await this.viewMetrics();
            break;
          case 'exit':
            running = false;
            break;
        }
      }

      console.log(chalk.blue('👋 Goodbye!'));

    } catch (error) {
      console.error(chalk.red('❌ System error:'), error);
      process.exit(1);
    } finally {
      await this.coordinator.cleanup();
    }
  }

  private async showMainMenu(): Promise<string> {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: '🔍 Quick Search', value: 'quick_search' },
          { name: '🎯 Advanced Search', value: 'advanced_search' },
          { name: '📋 Bulk Search', value: 'bulk_search' },
          { name: '⚙️  View Configuration', value: 'view_config' },
          { name: '📊 View Metrics', value: 'view_metrics' },
          { name: '🚪 Exit', value: 'exit' }
        ]
      }
    ]);

    return action;
  }

  private async quickSearch(): Promise<void> {
    console.log(chalk.cyan('\n🔍 Quick Search'));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'searchType',
        message: 'Choose search type:',
        choices: [
          { name: 'LinkedIn Search', value: 'linkedin' },
          { name: 'Business Directory', value: 'directory' },
          { name: 'Website Extraction', value: 'website' }
        ]
      },
      {
        type: 'input',
        name: 'query',
        message: 'Enter search query:',
        validate: (input) => input.length > 0 || 'Please enter a search query'
      },
      {
        type: 'number',
        name: 'maxResults',
        message: 'Maximum results:',
        default: 10,
        validate: (input) => input > 0 && input <= 100 || 'Please enter a number between 1 and 100'
      }
    ]);

    let task: TaskConfig;

    switch (answers.searchType) {
      case 'linkedin':
        task = this.coordinator.createLinkedInSearchTask(answers.query, answers.maxResults);
        break;
      case 'directory':
        const { location } = await inquirer.prompt([
          {
            type: 'input',
            name: 'location',
            message: 'Enter location:',
            default: 'United States'
          }
        ]);
        task = this.coordinator.createDirectorySearchTask(
          'https://www.yellowpages.com',
          answers.query,
          location,
          answers.maxResults
        );
        break;
      case 'website':
        const { websiteUrl } = await inquirer.prompt([
          {
            type: 'input',
            name: 'websiteUrl',
            message: 'Enter website URL:',
            validate: (input) => {
              try {
                new URL(input);
                return true;
              } catch {
                return 'Please enter a valid URL';
              }
            }
          }
        ]);
        task = this.coordinator.createWebsiteExtractionTask(websiteUrl, answers.maxResults);
        break;
      default:
        return;
    }

    await this.executeSearchWithProgress([task]);
  }

  private async advancedSearch(): Promise<void> {
    console.log(chalk.cyan('\n🎯 Advanced Search'));

    const searchConfig = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'sources',
        message: 'Select search sources:',
        choices: [
          { name: 'LinkedIn', value: 'linkedin' },
          { name: 'Yellow Pages', value: 'yellowpages' },
          { name: 'Yelp', value: 'yelp' },
          { name: 'Google Maps', value: 'googlemaps' },
          { name: 'Custom Website', value: 'website' }
        ],
        validate: (choices) => choices.length > 0 || 'Please select at least one source'
      },
      {
        type: 'input',
        name: 'searchQuery',
        message: 'Search query:',
        validate: (input) => input.length > 0 || 'Please enter a search query'
      },
      {
        type: 'input',
        name: 'location',
        message: 'Location (optional):',
        default: ''
      },
      {
        type: 'input',
        name: 'industry',
        message: 'Industry filter (optional):',
        default: ''
      },
      {
        type: 'number',
        name: 'maxResultsPerSource',
        message: 'Max results per source:',
        default: 15,
        validate: (input) => input > 0 && input <= 50 || 'Please enter a number between 1 and 50'
      }
    ]);

    // Additional website URL if website source is selected
    let websiteUrl = '';
    if (searchConfig.sources.includes('website')) {
      const { url } = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Website URL:',
          validate: (input) => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Please enter a valid URL';
            }
          }
        }
      ]);
      websiteUrl = url;
    }

    // Build tasks based on selected sources
    const tasks: TaskConfig[] = [];
    const filters = {
      location: searchConfig.location || undefined,
      industry: searchConfig.industry || undefined
    };

    if (searchConfig.sources.includes('linkedin')) {
      tasks.push(this.coordinator.createLinkedInSearchTask(
        searchConfig.searchQuery,
        searchConfig.maxResultsPerSource,
        filters
      ));
    }

    if (searchConfig.sources.includes('yellowpages')) {
      tasks.push(this.coordinator.createDirectorySearchTask(
        'https://www.yellowpages.com',
        searchConfig.searchQuery,
        searchConfig.location || 'United States',
        searchConfig.maxResultsPerSource
      ));
    }

    if (searchConfig.sources.includes('yelp')) {
      tasks.push(this.coordinator.createDirectorySearchTask(
        'https://www.yelp.com',
        searchConfig.searchQuery,
        searchConfig.location || 'United States',
        searchConfig.maxResultsPerSource
      ));
    }

    if (searchConfig.sources.includes('googlemaps')) {
      tasks.push(this.coordinator.createDirectorySearchTask(
        'https://www.google.com/maps',
        searchConfig.searchQuery,
        searchConfig.location || 'United States',
        searchConfig.maxResultsPerSource
      ));
    }

    if (searchConfig.sources.includes('website') && websiteUrl) {
      tasks.push(this.coordinator.createWebsiteExtractionTask(
        websiteUrl,
        searchConfig.maxResultsPerSource
      ));
    }

    await this.executeSearchWithProgress(tasks);
  }

  private async bulkSearch(): Promise<void> {
    console.log(chalk.cyan('\n📋 Bulk Search'));

    const bulkConfig = await inquirer.prompt([
      {
        type: 'list',
        name: 'bulkType',
        message: 'Bulk search type:',
        choices: [
          { name: 'Multiple Companies (LinkedIn)', value: 'companies' },
          { name: 'Multiple Industries (Directory)', value: 'industries' },
          { name: 'Multiple Websites', value: 'websites' }
        ]
      },
      {
        type: 'editor',
        name: 'bulkInput',
        message: 'Enter items (one per line):',
        validate: (input) => input.trim().length > 0 || 'Please enter at least one item'
      },
      {
        type: 'number',
        name: 'maxResultsPerItem',
        message: 'Max results per item:',
        default: 10,
        validate: (input) => input > 0 && input <= 30 || 'Please enter a number between 1 and 30'
      }
    ]);

    const items = bulkConfig.bulkInput.trim().split('\n').filter(item => item.trim());
    const tasks: TaskConfig[] = [];

    switch (bulkConfig.bulkType) {
      case 'companies':
        for (const company of items) {
          tasks.push(this.coordinator.createLinkedInSearchTask(
            `people at ${company.trim()}`,
            bulkConfig.maxResultsPerItem,
            { company: company.trim() }
          ));
        }
        break;

      case 'industries':
        const { location } = await inquirer.prompt([
          {
            type: 'input',
            name: 'location',
            message: 'Location for industry search:',
            default: 'United States'
          }
        ]);

        for (const industry of items) {
          tasks.push(this.coordinator.createDirectorySearchTask(
            'https://www.yellowpages.com',
            industry.trim(),
            location,
            bulkConfig.maxResultsPerItem
          ));
        }
        break;

      case 'websites':
        for (const website of items) {
          try {
            new URL(website.trim()); // Validate URL
            tasks.push(this.coordinator.createWebsiteExtractionTask(
              website.trim(),
              bulkConfig.maxResultsPerItem
            ));
          } catch {
            console.log(chalk.yellow(`⚠️  Skipping invalid URL: ${website.trim()}`));
          }
        }
        break;
    }

    if (tasks.length === 0) {
      console.log(chalk.red('❌ No valid tasks created'));
      return;
    }

    console.log(chalk.green(`✅ Created ${tasks.length} tasks`));
    await this.executeSearchWithProgress(tasks);
  }

  private async executeSearchWithProgress(tasks: TaskConfig[]): Promise<void> {
    console.log(chalk.yellow(`\n🔄 Executing ${tasks.length} task(s)...`));

    // Create progress bar
    const progressBar = new cliProgress.SingleBar({
      format: 'Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} tasks | ETA: {eta}s',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true
    });

    try {
      progressBar.start(tasks.length, 0);

      const startTime = Date.now();
      const leads = await this.coordinator.executeTasks(tasks);
      const executionTime = Date.now() - startTime;

      progressBar.update(tasks.length);
      progressBar.stop();

      // Display results
      console.log(chalk.green(`\n✅ Search completed!`));
      console.log(chalk.white(`📊 Results: ${leads.length} leads found`));
      console.log(chalk.white(`⏱️  Execution time: ${Math.round(executionTime / 1000)}s`));

      if (leads.length > 0) {
        // Show preview of top leads
        console.log(chalk.cyan('\n🏆 Top 5 leads:'));
        leads.slice(0, 5).forEach((lead, index) => {
          console.log(chalk.white(`${index + 1}. ${lead.name} - ${lead.company || 'N/A'} (${(lead.confidence * 100).toFixed(1)}%)`));
        });

        // Ask about export
        const { shouldExport } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldExport',
            message: 'Export results?',
            default: true
          }
        ]);

        if (shouldExport) {
          await this.exportResults(leads, executionTime);
        }
      } else {
        console.log(chalk.yellow('⚠️  No leads found. Try adjusting your search criteria.'));
      }

    } catch (error) {
      progressBar.stop();
      console.error(chalk.red(`❌ Search failed: ${error}`));
      logger.error('CLI search execution failed', { error });
    }
  }

  private async exportResults(leads: Lead[], executionTime: number): Promise<void> {
    const { exportFormat } = await inquirer.prompt([
      {
        type: 'list',
        name: 'exportFormat',
        message: 'Export format:',
        choices: [
          { name: 'CSV only', value: 'csv' },
          { name: 'JSON only', value: 'json' },
          { name: 'HTML Report only', value: 'html' },
          { name: 'All formats', value: 'all' }
        ]
      }
    ]);

    try {
      console.log(chalk.yellow('📤 Exporting results...'));

      const metrics = await this.coordinator.getMetrics();
      let exportedFiles: string[] = [];

      switch (exportFormat) {
        case 'csv':
          const csvFile = await this.outputManager.exportToCSV(leads);
          exportedFiles.push(csvFile);
          break;
        case 'json':
          const jsonFile = await this.outputManager.exportToJSON(leads);
          exportedFiles.push(jsonFile);
          break;
        case 'html':
          const htmlFile = await this.outputManager.exportSummaryReport(
            leads,
            metrics.stagehandMetrics || [],
            executionTime
          );
          exportedFiles.push(htmlFile);
          break;
        case 'all':
          const allFiles = await this.outputManager.exportToMultipleFormats(
            leads,
            metrics.stagehandMetrics || [],
            executionTime
          );
          exportedFiles = Object.values(allFiles);
          break;
      }

      console.log(chalk.green('✅ Export completed:'));
      exportedFiles.forEach(file => {
        console.log(chalk.white(`   📄 ${file}`));
      });

    } catch (error) {
      console.error(chalk.red(`❌ Export failed: ${error}`));
    }
  }

  private async viewConfiguration(): Promise<void> {
    console.log(chalk.cyan('\n⚙️  Current Configuration'));

    const config = ConfigManager.getInstance().config;
    
    console.log(chalk.white('OpenAI:'));
    console.log(`  Model: ${config.openai.model}`);
    console.log(`  Temperature: ${config.openai.temperature}`);
    
    console.log(chalk.white('\nStagehand:'));
    console.log(`  Headless: ${config.stagehand.headless}`);
    console.log(`  Timeout: ${config.stagehand.timeout}ms`);
    
    console.log(chalk.white('\nCompliance:'));
    console.log(`  Respect robots.txt: ${config.compliance.respectRobotsTxt}`);
    console.log(`  Rate limit delay: ${config.compliance.rateLimitDelay}ms`);
    console.log(`  User agent: ${config.compliance.userAgent}`);
    
    console.log(chalk.white('\nOutput:'));
    console.log(`  Directory: ${config.output.directory}`);
    console.log(`  CSV file: ${config.output.csvFile}`);
    
    console.log(chalk.white('\nHuman in Loop:'));
    console.log(`  Require approval: ${config.humanInLoop.requireApproval}`);
    console.log(`  Auto approve: ${config.humanInLoop.autoApprove}`);

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...'
      }
    ]);
  }

  private async viewMetrics(): Promise<void> {
    console.log(chalk.cyan('\n📊 System Metrics'));

    try {
      const metrics = await this.coordinator.getMetrics();
      
      if (metrics.stagehandMetrics && metrics.stagehandMetrics.length > 0) {
        console.log(chalk.white('Recent Task Metrics:'));
        metrics.stagehandMetrics.forEach(metric => {
          console.log(`  Task: ${metric.taskId}`);
          console.log(`    Leads: ${metric.leadsExtracted}`);
          console.log(`    LLM Calls: ${metric.llmCallsCount}`);
          console.log(`    Success Rate: ${(metric.successRate * 100).toFixed(1)}%`);
          console.log(`    Execution Time: ${Math.round(metric.executionTime / 1000)}s`);
          console.log('');
        });
      } else {
        console.log(chalk.yellow('No task metrics available yet.'));
      }

      if (metrics.cacheStats) {
        console.log(chalk.white('Cache Statistics:'));
        console.log(`  Hit Rate: ${(metrics.cacheStats.hitRate * 100).toFixed(1)}%`);
        console.log(`  Total Keys: ${metrics.cacheStats.keys}`);
        console.log(`  Cache Hits: ${metrics.cacheStats.hits}`);
        console.log(`  Cache Misses: ${metrics.cacheStats.misses}`);
      }

    } catch (error) {
      console.error(chalk.red('Failed to load metrics:'), error);
    }

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...'
      }
    ]);
  }
}