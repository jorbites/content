import { translateEvents } from './translate-events';
import { translateBlogs } from './translate-blogs';

async function runAllTranslations() {
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');
    const runEventsOnly = args.includes('--events');
    const runBlogsOnly = args.includes('--blogs');

    if (runEventsOnly) {
        await translateEvents(isDryRun);
    } else if (runBlogsOnly) {
        await translateBlogs(isDryRun);
    } else {
        await translateEvents(isDryRun);
        console.log('');
        await translateBlogs(isDryRun);
    }
}

if (require.main === module) {
    runAllTranslations().catch((err) => {
        console.error('❌ [translate] Translation failed:', err);
        process.exit(1);
    });
}
