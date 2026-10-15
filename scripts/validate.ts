import { validateEvents, ValidationIssue } from './validate-events';
import { validateBlogs } from './validate-blogs';

/**
 * Enforce isolation: ensure a pull request does not mix events and blogs,
 * and only submits at most one item at a time.
 */
export function validateSubmissionScope(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Only enforce single-submission rule on PRs or diff targets
    const isPr = Boolean(process.env.GITHUB_BASE_REF);
    const { execSync } = require('child_process');

    const diffTargets = [
        process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
        !isPr && process.env.GITHUB_REF === 'refs/heads/main' ? null : 'origin/main...HEAD',
    ].filter(Boolean) as string[];

    let changedFiles: string[] = [];
    for (const target of diffTargets) {
        try {
            const output = execSync(`git diff --name-only ${target}`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            changedFiles = output.split('\n').map((l: string) => l.trim()).filter(Boolean);
            if (changedFiles.length > 0) break;
        } catch {}
    }

    if (changedFiles.length === 0) {
        return issues;
    }

    let hasEventChanges = false;
    let hasBlogChanges = false;
    const eventSlugs = new Set<string>();
    const blogSlugs = new Set<string>();

    for (const file of changedFiles) {
        if (/^(?:content\/events|images\/events|badges)\//.test(file)) {
            hasEventChanges = true;
            const m = file.match(/^content\/events\/(?:ca|en|es)\/(.+)\.md$/);
            if (m) eventSlugs.add(m[1]);
        }
        if (/^(?:content\/blogs|images\/blogs)\//.test(file)) {
            hasBlogChanges = true;
            const m = file.match(/^content\/blogs\/(?:ca|en|es)\/(.+)\.md$/);
            if (m) blogSlugs.add(m[1]);
        }
    }

    // 1. Block mixing Events and Blogs
    if (hasEventChanges && hasBlogChanges) {
        issues.push({
            file: 'Submission Scope',
            message:
                'Mixed content types detected! You cannot submit both an Event and a Blog Post in the same pull request. Please submit them separately to keep pipelines isolated.',
            type: 'error',
        });
    }

    // 2. Block multiple events at once in a single PR
    if (eventSlugs.size > 1) {
        issues.push({
            file: 'content/events',
            message: `Multiple events detected in a single submission (${Array.from(eventSlugs).join(', ')}). Only one event can be submitted per pull request.`,
            type: 'error',
        });
    }

    // 3. Block multiple blogs at once in a single PR
    if (blogSlugs.size > 1) {
        issues.push({
            file: 'content/blogs',
            message: `Multiple blog posts detected in a single submission (${Array.from(blogSlugs).join(', ')}). Only one blog post can be submitted per pull request.`,
            type: 'error',
        });
    }

    return issues;
}

async function runAllValidation() {
    const args = process.argv.slice(2);
    const runEventsOnly = args.includes('--events');
    const runBlogsOnly = args.includes('--blogs');

    let allIssues: ValidationIssue[] = [];

    // Scope check: block mixed or multi submissions
    const scopeIssues = validateSubmissionScope();
    allIssues.push(...scopeIssues);

    if (runEventsOnly) {
        allIssues.push(...(await validateEvents()));
    } else if (runBlogsOnly) {
        allIssues.push(...(await validateBlogs()));
    } else {
        const eventIssues = await validateEvents();
        console.log('');
        const blogIssues = await validateBlogs();
        allIssues.push(...eventIssues, ...blogIssues);
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

if (require.main === module) {
    runAllValidation().catch((err) => {
        console.error('Fatal validation error:', err);
        process.exit(1);
    });
}
