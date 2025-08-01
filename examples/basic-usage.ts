/**
 * Basic Usage Examples for Lead Generation System
 * 
 * This file demonstrates various ways to use the lead generation system
 * programmatically for different use cases.
 */

import { LeadGenerationCoordinator } from '../src/agents/coordinator';
import { LinkedInAgent } from '../src/agents/linkedin';
import { DirectoryAgent } from '../src/agents/directory';
import { WebsiteAgent } from '../src/agents/website';
import { OutputManager } from '../src/output/manager';
import { StagehandWrapper } from '../src/stagehand/wrapper';
import { TaskConfig, Lead } from '../src/types';

/**
 * Example 1: Simple LinkedIn Search
 */
async function simpleLinkedInSearch() {
  console.log('🔍 Example 1: Simple LinkedIn Search');
  
  const coordinator = new LeadGenerationCoordinator();
  await coordinator.initialize();

  try {
    // Create LinkedIn search task
    const task = coordinator.createLinkedInSearchTask(
      "software engineers in San Francisco", 
      15,
      {
        location: "San Francisco Bay Area",
        industry: "Technology"
      }
    );

    // Execute the task
    const leads = await coordinator.executeTasks([task]);
    
    console.log(`✅ Found ${leads.length} leads from LinkedIn`);
    
    // Export to CSV
    const outputManager = new OutputManager();
    const csvFile = await outputManager.exportToCSV(leads, 'linkedin_example.csv');
    console.log(`📄 Results exported to: ${csvFile}`);

  } finally {
    await coordinator.cleanup();
  }
}

/**
 * Example 2: Multi-Source Lead Generation
 */
async function multiSourceSearch() {
  console.log('🔍 Example 2: Multi-Source Lead Generation');
  
  const coordinator = new LeadGenerationCoordinator();
  await coordinator.initialize();

  try {
    // Create tasks for multiple sources
    const tasks: TaskConfig[] = [
      coordinator.createLinkedInSearchTask(
        "product managers at tech startups",
        10,
        { location: "New York", industry: "Technology" }
      ),
      coordinator.createDirectorySearchTask(
        "https://www.yellowpages.com",
        "software companies",
        "New York",
        15
      ),
      coordinator.createWebsiteExtractionTask(
        "https://techcrunch.com/startups/",
        10
      )
    ];

    // Execute all tasks
    const leads = await coordinator.executeTasks(tasks);
    
    console.log(`✅ Found ${leads.length} total leads from ${tasks.length} sources`);
    
    // Analyze results by source
    const sourceBreakdown = leads.reduce((acc, lead) => {
      acc[lead.source] = (acc[lead.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('📊 Source breakdown:', sourceBreakdown);

    // Export to multiple formats
    const outputManager = new OutputManager();
    const files = await outputManager.exportToMultipleFormats(
      leads, 
      await coordinator.getMetrics().then(m => m.stagehandMetrics || []),
      Date.now()
    );
    
    console.log('📤 Exported files:', files);

  } finally {
    await coordinator.cleanup();
  }
}

/**
 * Example 3: Company-Specific Lead Generation
 */
async function companySpecificSearch() {
  console.log('🔍 Example 3: Company-Specific Lead Generation');
  
  const stagehand = new StagehandWrapper();
  await stagehand.initialize();
  
  const linkedinAgent = new LinkedInAgent(stagehand);

  try {
    const companies = [
      "OpenAI",
      "Anthropic", 
      "Google",
      "Microsoft",
      "Meta"
    ];

    const allLeads: Lead[] = [];

    for (const company of companies) {
      console.log(`🏢 Searching for employees at ${company}...`);
      
      const leads = await linkedinAgent.searchByCompany(company, 8);
      allLeads.push(...leads);
      
      console.log(`   ✅ Found ${leads.length} leads from ${company}`);
      
      // Respect rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log(`🎯 Total leads found: ${allLeads.length}`);
    
    // Group by company
    const leadsByCompany = allLeads.reduce((acc, lead) => {
      const company = lead.company || 'Unknown';
      if (!acc[company]) acc[company] = [];
      acc[company].push(lead);
      return acc;
    }, {} as Record<string, Lead[]>);

    // Export separate files per company
    const outputManager = new OutputManager();
    for (const [company, companyLeads] of Object.entries(leadsByCompany)) {
      const filename = `${company.toLowerCase().replace(/\s+/g, '_')}_leads.csv`;
      await outputManager.exportToCSV(companyLeads, filename);
      console.log(`📄 ${company}: ${companyLeads.length} leads → ${filename}`);
    }

  } finally {
    await stagehand.cleanup();
  }
}

/**
 * Example 4: Industry-Specific Directory Search
 */
async function industryDirectorySearch() {
  console.log('🔍 Example 4: Industry-Specific Directory Search');
  
  const stagehand = new StagehandWrapper();
  await stagehand.initialize();
  
  const directoryAgent = new DirectoryAgent(stagehand);

  try {
    const industries = [
      "restaurants",
      "legal services", 
      "marketing agencies",
      "consulting firms"
    ];

    const location = "Los Angeles, CA";
    const allLeads: Lead[] = [];

    for (const industry of industries) {
      console.log(`🏭 Searching ${industry} in ${location}...`);
      
      // Search multiple directories for this industry
      const leads = await directoryAgent.searchMultipleDirectories(
        industry,
        location,
        12 // 12 results per directory
      );
      
      allLeads.push(...leads);
      console.log(`   ✅ Found ${leads.length} leads for ${industry}`);
    }

    console.log(`📊 Total leads: ${allLeads.length}`);

    // Filter by confidence score
    const highConfidenceLeads = allLeads.filter(lead => lead.confidence >= 0.7);
    console.log(`⭐ High confidence leads: ${highConfidenceLeads.length}`);

    // Export with confidence filtering
    const outputManager = new OutputManager();
    await outputManager.exportToCSV(highConfidenceLeads, 'high_confidence_leads.csv');
    await outputManager.exportToCSV(allLeads, 'all_industry_leads.csv');

  } finally {
    await stagehand.cleanup();
  }
}

/**
 * Example 5: Website Contact Extraction
 */
async function websiteContactExtraction() {
  console.log('🔍 Example 5: Website Contact Extraction');
  
  const stagehand = new StagehandWrapper();
  await stagehand.initialize();
  
  const websiteAgent = new WebsiteAgent(stagehand);

  try {
    const websites = [
      "https://www.hubspot.com/company/management",
      "https://about.gitlab.com/company/team/",
      "https://www.notion.so/about",
      "https://www.figma.com/about/",
      "https://slack.com/about-leadership"
    ];

    const leads = await websiteAgent.extractFromMultiplePages(websites, 15);
    
    console.log(`✅ Extracted ${leads.length} contacts from ${websites.length} websites`);

    // Analyze extraction success by website
    const siteStats = websites.map(url => {
      const siteLeads = leads.filter(lead => lead.website === url);
      return {
        url,
        leadsFound: siteLeads.length,
        avgConfidence: siteLeads.length > 0 
          ? siteLeads.reduce((sum, lead) => sum + lead.confidence, 0) / siteLeads.length 
          : 0
      };
    });

    console.log('📈 Website extraction stats:');
    siteStats.forEach(stat => {
      console.log(`   ${stat.url}: ${stat.leadsFound} leads (avg confidence: ${(stat.avgConfidence * 100).toFixed(1)}%)`);
    });

    // Export with source analysis
    const outputManager = new OutputManager();
    await outputManager.exportToJSON(leads, 'website_contacts.json');

  } finally {
    await stagehand.cleanup();
  }
}

/**
 * Example 6: Advanced Configuration and Filtering
 */
async function advancedConfigurationExample() {
  console.log('🔍 Example 6: Advanced Configuration');
  
  const coordinator = new LeadGenerationCoordinator();
  await coordinator.initialize();

  try {
    // Create highly specific task with custom configuration
    const advancedTask: TaskConfig = {
      id: `advanced-search-${Date.now()}`,
      type: 'linkedin_search',
      target: 'https://www.linkedin.com',
      searchQuery: 'VP of Engineering at unicorn startups',
      maxResults: 25,
      filters: {
        location: 'San Francisco Bay Area',
        industry: 'Internet',
        experienceLevel: 'Senior',
        companySize: '501-1000'
      },
      priority: 'high',
      retryAttempts: 3
    };

    const leads = await coordinator.executeTasks([advancedTask]);

    // Advanced filtering and scoring
    const filteredLeads = leads
      .filter(lead => lead.confidence >= 0.8)
      .filter(lead => lead.email || lead.linkedin)
      .sort((a, b) => b.confidence - a.confidence);

    console.log(`🎯 High-quality leads: ${filteredLeads.length}/${leads.length}`);

    // Generate comprehensive reports
    const outputManager = new OutputManager();
    const metrics = await coordinator.getMetrics();
    
    await outputManager.exportMetricsReport(
      metrics.stagehandMetrics || [],
      {
        searchQuery: advancedTask.searchQuery,
        totalResults: leads.length,
        qualityScore: filteredLeads.length / leads.length
      },
      'advanced_search_metrics.json'
    );

    await outputManager.generateComplianceReport(filteredLeads);

  } finally {
    await coordinator.cleanup();
  }
}

/**
 * Example 7: Real-time Processing with Progress Tracking
 */
async function realTimeProcessingExample() {
  console.log('🔍 Example 7: Real-time Processing');
  
  const coordinator = new LeadGenerationCoordinator();
  await coordinator.initialize();

  try {
    const searchQueries = [
      "data scientists in Seattle",
      "product managers in Austin", 
      "software engineers in Boston",
      "marketing directors in Denver",
      "sales managers in Miami"
    ];

    const allLeads: Lead[] = [];
    
    console.log(`🚀 Processing ${searchQueries.length} search queries...`);

    for (let i = 0; i < searchQueries.length; i++) {
      const query = searchQueries[i];
      console.log(`\n[${i + 1}/${searchQueries.length}] Processing: ${query}`);
      
      const task = coordinator.createLinkedInSearchTask(query, 10);
      const leads = await coordinator.executeTasks([task]);
      
      allLeads.push(...leads);
      
      console.log(`   ✅ ${leads.length} leads found (Total: ${allLeads.length})`);
      
      // Export intermediate results
      if ((i + 1) % 2 === 0) {
        const outputManager = new OutputManager();
        await outputManager.exportToCSV(
          allLeads, 
          `intermediate_results_${i + 1}.csv`
        );
        console.log(`   💾 Intermediate results saved`);
      }
    }

    console.log(`\n🎉 Processing complete! Total leads: ${allLeads.length}`);

    // Final export with full metrics
    const outputManager = new OutputManager();
    const metrics = await coordinator.getMetrics();
    
    await outputManager.exportToMultipleFormats(
      allLeads,
      metrics.stagehandMetrics || [],
      Date.now()
    );

  } finally {
    await coordinator.cleanup();
  }
}

// Main execution function
async function runExamples() {
  console.log('🚀 Lead Generation System - Usage Examples\n');

  const examples = [
    { name: 'Simple LinkedIn Search', fn: simpleLinkedInSearch },
    { name: 'Multi-Source Search', fn: multiSourceSearch },
    { name: 'Company-Specific Search', fn: companySpecificSearch },
    { name: 'Industry Directory Search', fn: industryDirectorySearch },
    { name: 'Website Contact Extraction', fn: websiteContactExtraction },
    { name: 'Advanced Configuration', fn: advancedConfigurationExample },
    { name: 'Real-time Processing', fn: realTimeProcessingExample }
  ];

  // Run a specific example or all of them
  const exampleToRun = process.argv[2];
  
  if (exampleToRun) {
    const example = examples.find(ex => 
      ex.name.toLowerCase().includes(exampleToRun.toLowerCase())
    );
    
    if (example) {
      await example.fn();
    } else {
      console.log('❌ Example not found. Available examples:');
      examples.forEach((ex, i) => console.log(`   ${i + 1}. ${ex.name}`));
    }
  } else {
    console.log('📚 Available examples:');
    examples.forEach((ex, i) => console.log(`   ${i + 1}. ${ex.name}`));
    console.log('\nRun with: npm run example <example-name>');
  }
}

// Execute if called directly
if (require.main === module) {
  runExamples().catch(console.error);
}

export {
  simpleLinkedInSearch,
  multiSourceSearch,
  companySpecificSearch,
  industryDirectorySearch,
  websiteContactExtraction,
  advancedConfigurationExample,
  realTimeProcessingExample
};