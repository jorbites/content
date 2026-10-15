import { validateEvents, ValidationIssue } from './validate-events';
import { validateBlogs } from './validate-blogs';

async function runAllValidation() {
    const args = process.argv.slice(2);
    const runEventsOnly = args.includes('--events');
    const runBlogsOnly = args.includes('--blogs');

    let allIssues: ValidationIssue[] = [];

    if (runEventsOnly) {
        allIssues = await validateEvents();
    } else if (runBlogsOnly) {
        allIssues = await validateBlogs();
    } else {
        const eventIssues = await validateEvents();
        console.log('');
        const blogIssues = await validateBlogs();
        allIssues = [...eventIssues, ...blogIssues];
    }

    const errors = allIssues.filter((i) => i.type === 'error');
    const warnings = allIssues.filter((i) => i.type === 'warning');

    if (warnings.length > 0) {
        console.log(`\n⚠️  Total ${warnings.length} Warning(s):`);
        for (const w of warnings.slice(0, 10)) {
            console.log(`   - ${w.file}: ${w.message}`);
        }
        if (warnings.length > 10) {
            console.log(`   ... and ${warnings.length - 10} more warnings.`);
        }
    }

    if (errors.length > 0) {
        console.error(`\n❌ Validation failed with ${errors.length} error(s):\n`);
        for (const e of errors) {
            console.error(`   - ${e.file}: ${e.message}`);
        }
        process.exit(1);
    } else {
        console.log('\n🎉 [validate] All content and media passed validation successfully!\n');
        process.exit(0);
    }
}

runAllValidation().catch((err) => {
    console.error('Fatal validation error:', err);
    process.exit(1);
});
