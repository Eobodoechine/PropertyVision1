#!/usr/bin/env tsx

/**
 * Usage Limit Management Script
 *
 * This script helps you manually manage usage limits for GPT users.
 *
 * Usage:
 *   npx tsx scripts/manage-usage-limits.ts <command> [options]
 *
 * Commands:
 *   check <email>                          - Check usage for an email
 *   increase <email> <newLimit> [reason]   - Increase limit for an email
 *   reset <email>                          - Reset usage count (keeps limit)
 *
 * Examples:
 *   npx tsx scripts/manage-usage-limits.ts check user@example.com
 *   npx tsx scripts/manage-usage-limits.ts increase user@example.com 10 "Failed analysis compensation"
 *   npx tsx scripts/manage-usage-limits.ts reset user@example.com
 */

import { usageTracker } from '../src/server/utils/usageTracker';

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Usage Limit Management Script

Commands:
  check <email>                          - Check usage for an email
  increase <email> <newLimit> [reason]   - Increase limit for an email
  reset <email>                          - Reset usage count (keeps limit)

Examples:
  npx tsx scripts/manage-usage-limits.ts check user@example.com
  npx tsx scripts/manage-usage-limits.ts increase user@example.com 10 "Failed analysis"
  npx tsx scripts/manage-usage-limits.ts reset user@example.com
    `);
    process.exit(0);
  }

  const command = args[0];
  const email = args[1];

  switch (command) {
    case 'check':
      if (!email) {
        console.error('❌ Error: Email required');
        console.log('Usage: npx tsx scripts/manage-usage-limits.ts check <email>');
        process.exit(1);
      }
      await checkUsage(email);
      break;

    case 'increase':
      const newLimit = parseInt(args[2]);
      const reason = args.slice(3).join(' ') || 'Manual adjustment';

      if (!email || isNaN(newLimit)) {
        console.error('❌ Error: Email and new limit (number) required');
        console.log('Usage: npx tsx scripts/manage-usage-limits.ts increase <email> <newLimit> [reason]');
        process.exit(1);
      }
      await increaseLimit(email, newLimit, reason);
      break;

    case 'reset':
      if (!email) {
        console.error('❌ Error: Email required');
        console.log('Usage: npx tsx scripts/manage-usage-limits.ts reset <email>');
        process.exit(1);
      }
      await resetUsage(email);
      break;

    default:
      console.error(`❌ Error: Unknown command '${command}'`);
      console.log('Available commands: check, increase, reset');
      process.exit(1);
  }

  process.exit(0);
}

async function checkUsage(email: string) {
  console.log(`\n📊 Checking usage for: ${email}\n`);

  try {
    const stats = await usageTracker.getUsageStats(email);

    console.log('Current Usage:');
    console.log('─'.repeat(50));
    console.log(`  Analyses Used:      ${stats.analysesUsed}`);
    console.log(`  Analyses Limit:     ${stats.analysesLimit}`);
    console.log(`  Analyses Remaining: ${stats.analysesRemaining}`);
    console.log(`  Can Analyze:        ${stats.canAnalyze ? '✅ Yes' : '❌ No'}`);
    if (stats.lastAnalysis) {
      console.log(`  Last Analysis:      ${stats.lastAnalysis.toLocaleString()}`);
    }
    console.log('─'.repeat(50));

    const record = await usageTracker.getUsageRecord(email);
    if (record && record.limitIncreases && record.limitIncreases.length > 0) {
      console.log('\nLimit Increase History:');
      console.log('─'.repeat(50));
      record.limitIncreases.forEach((increase, index) => {
        console.log(`  ${index + 1}. ${increase.previousLimit} → ${increase.newLimit}`);
        console.log(`     Reason: ${increase.reason || 'Not specified'}`);
        console.log(`     By: ${increase.increasedBy}`);
        console.log(`     Date: ${increase.increasedAt.toLocaleString()}`);
        console.log();
      });
    }

  } catch (error: any) {
    console.error('❌ Error checking usage:', error.message);
    process.exit(1);
  }
}

async function increaseLimit(email: string, newLimit: number, reason: string) {
  console.log(`\n✨ Increasing limit for: ${email}\n`);

  try {
    // Check current usage first
    const stats = await usageTracker.getUsageStats(email);
    console.log(`Current limit: ${stats.analysesLimit}`);
    console.log(`New limit:     ${newLimit}`);
    console.log(`Reason:        ${reason}\n`);

    if (newLimit <= stats.analysesLimit) {
      console.error(`❌ Error: New limit (${newLimit}) must be greater than current limit (${stats.analysesLimit})`);
      process.exit(1);
    }

    await usageTracker.increaseLimit(email, newLimit, reason, 'admin-script');

    console.log('✅ Limit increased successfully!\n');

    // Show updated stats
    const updatedStats = await usageTracker.getUsageStats(email);
    console.log('Updated Usage:');
    console.log('─'.repeat(50));
    console.log(`  Analyses Used:      ${updatedStats.analysesUsed}`);
    console.log(`  Analyses Limit:     ${updatedStats.analysesLimit}`);
    console.log(`  Analyses Remaining: ${updatedStats.analysesRemaining}`);
    console.log('─'.repeat(50));

  } catch (error: any) {
    console.error('❌ Error increasing limit:', error.message);
    process.exit(1);
  }
}

async function resetUsage(email: string) {
  console.log(`\n🔄 Resetting usage count for: ${email}\n`);

  try {
    // Check current usage first
    const statsBefore = await usageTracker.getUsageStats(email);
    console.log(`Current usage: ${statsBefore.analysesUsed}/${statsBefore.analysesLimit}\n`);

    await usageTracker.resetUsage(email);

    console.log('✅ Usage count reset successfully!\n');

    // Show updated stats
    const statsAfter = await usageTracker.getUsageStats(email);
    console.log('Updated Usage:');
    console.log('─'.repeat(50));
    console.log(`  Analyses Used:      ${statsAfter.analysesUsed}`);
    console.log(`  Analyses Limit:     ${statsAfter.analysesLimit}`);
    console.log(`  Analyses Remaining: ${statsAfter.analysesRemaining}`);
    console.log('─'.repeat(50));

  } catch (error: any) {
    console.error('❌ Error resetting usage:', error.message);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
