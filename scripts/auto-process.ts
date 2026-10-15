import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { execSync } from 'child_process';
import {
    processEventCover,
    generateBadgeFromCover,
} from './process-event';
import {
    optimizeBlogImage,
    scanAndOptimizeAllBlogImages,
    normalizeBlogFiles,
} from './process-blog';

const EVENTS_CONTENT_DIR = path.resolve(__dirname, '../content/events');
const EVENTS_IMAGES_DIR = path.resolve(__dirname, '../images/events');
const BADGES_DIR = path.resolve(__dirname, '../badges');
const BLOGS_CONTENT_DIR = path.resolve(__dirname, '../content/blogs');
const BLOGS_IMAGES_DIR = path.resolve(__dirname, '../images/blogs');

const LOCALES = ['es', 'ca', 'en'];
const MAX_COVER_BYTES = 100 * 1024; // 100 KB

function isRembgInstalled(): boolean {
    try {
        execSync('which rembg', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function cleanFrontmatter(data: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
        if (v !== undefined) {
            cleaned[k] = v;
        }
    }
    return cleaned;
}

function getChangedItems(): { eventSlugs: Set<string>; blogSlugs: Set<string>; processAll: boolean } {
    const args = process.argv.slice(2);
    if (args.includes('--all')) {
        return { eventSlugs: new Set(), blogSlugs: new Set(), processAll: true };
    }

    const explicitSlug = args.find((a) => !a.startsWith('--'));
    if (explicitSlug) {
        const isEvent =
            fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'es', `${explicitSlug}.md`)) ||
            fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'ca', `${explicitSlug}.md`)) ||
            fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'en', `${explicitSlug}.md`));
        const isBlog =
            fs.existsSync(path.join(BLOGS_CONTENT_DIR, 'es', `${explicitSlug}.md`)) ||
            fs.existsSync(path.join(BLOGS_CONTENT_DIR, 'ca', `${explicitSlug}.md`)) ||
            fs.existsSync(path.join(BLOGS_CONTENT_DIR, 'en', `${explicitSlug}.md`));

        if (isBlog && !isEvent) {
            return { eventSlugs: new Set(), blogSlugs: new Set([explicitSlug]), processAll: false };
        }
        if (isEvent && !isBlog) {
            return { eventSlugs: new Set([explicitSlug]), blogSlugs: new Set(), processAll: false };
        }
        return {
            eventSlugs: new Set([explicitSlug]),
            blogSlugs: new Set([explicitSlug]),
            processAll: false,
        };
    }

    const eventSlugs = new Set<string>();
    const blogSlugs = new Set<string>();

    const diffTargets = [
        process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
        'origin/main...HEAD',
        'HEAD~1...HEAD',
    ].filter(Boolean) as string[];

    for (const target of diffTargets) {
        try {
            const output = execSync(`git diff --name-only ${target}`, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            for (const line of output.split('\n')) {
                const eventMatch = line.trim().match(/^(?:content\/events|images\/events)\/(?:es|ca|en\/)?(.+?)(?:\.md|\.webp|\.png|\.jpe?g)?$/);
                if (eventMatch && !eventMatch[1].includes('/')) {
                    eventSlugs.add(eventMatch[1]);
                }
                const blogMatch = line.trim().match(/^(?:content\/blogs|images\/blogs)\/(?:es|ca|en\/)?(.+?)(?:\.md|\.webp|\.png|\.jpe?g)?$/);
                if (blogMatch && !blogMatch[1].includes('/')) {
                    blogSlugs.add(blogMatch[1]);
                }
            }
            if (eventSlugs.size > 0 || blogSlugs.size > 0) {
                return { eventSlugs, blogSlugs, processAll: false };
            }
        } catch {}
    }

    try {
        const status = execSync('git status --porcelain', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        for (const line of status.split('\n')) {
            const file = line.trim().slice(3).trim();
            const eventMatch = file.match(/^(?:content\/events|images\/events)\/(?:es|ca|en\/)?(.+?)(?:\.md|\.webp|\.png|\.jpe?g)?$/);
            if (eventMatch && !eventMatch[1].includes('/')) {
                eventSlugs.add(eventMatch[1]);
            }
            const blogMatch = file.match(/^(?:content\/blogs|images\/blogs)\/(?:es|ca|en\/)?(.+?)(?:\.md|\.webp|\.png|\.jpe?g)?$/);
            if (blogMatch && !blogMatch[1].includes('/')) {
                blogSlugs.add(blogMatch[1]);
            }
        }
    } catch {}

    return { eventSlugs, blogSlugs, processAll: false };
}

/**
 * Process events: cover optimization & badge extraction
 */
async function processEvents(targetSlugs: Set<string>, processAll: boolean) {
    if (!fs.existsSync(EVENTS_CONTENT_DIR)) return { coversOptimized: 0, badgesGenerated: 0 };

    let slugsToProcess: string[] = [];
    if (processAll) {
        const all = new Set<string>();
        for (const loc of LOCALES) {
            const dir = path.join(EVENTS_CONTENT_DIR, loc);
            if (fs.existsSync(dir)) {
                for (const f of fs.readdirSync(dir)) {
                    if (f.endsWith('.md')) all.add(f.replace(/\.md$/, ''));
                }
            }
        }
        slugsToProcess = Array.from(all).sort();
    } else {
        slugsToProcess = Array.from(targetSlugs).sort();
    }

    if (slugsToProcess.length === 0) {
        console.log('ℹ️ [auto-process] No event changes detected.');
        return { coversOptimized: 0, badgesGenerated: 0 };
    }

    console.log(`🎯 [auto-process] Processing ${slugsToProcess.length} event(s): ${slugsToProcess.join(', ')}`);
    const rembgAvailable = isRembgInstalled();
    let coversOptimized = 0;
    let badgesGenerated = 0;

    for (const slug of slugsToProcess) {
        let frontmatter: any = null;
        const localizedFiles: { locale: string; filePath: string; parsed: matter.GrayMatterFile<string> }[] = [];

        for (const loc of LOCALES) {
            const locPath = path.join(EVENTS_CONTENT_DIR, loc, `${slug}.md`);
            if (fs.existsSync(locPath)) {
                const parsed = matter(fs.readFileSync(locPath, 'utf8'));
                localizedFiles.push({ locale: loc, filePath: locPath, parsed });
            }
        }

        if (localizedFiles.length === 0) continue;

        const combinedFrontmatter: Record<string, any> = {};
        for (const locFile of localizedFiles) {
            for (const [key, val] of Object.entries(locFile.parsed.data)) {
                if (val !== undefined && val !== null && val !== '' && combinedFrontmatter[key] === undefined) {
                    combinedFrontmatter[key] = val;
                }
            }
        }
        frontmatter = combinedFrontmatter;

        let needsCoverOptimization = false;
        let coverSourcePath: string | null = null;
        const targetCoverPath = path.join(EVENTS_IMAGES_DIR, `${slug}.webp`);

        // Check if cover already exists in images/events/
        if (fs.existsSync(targetCoverPath)) {
            const stats = fs.statSync(targetCoverPath);
            if (stats.size > MAX_COVER_BYTES) {
                needsCoverOptimization = true;
                coverSourcePath = targetCoverPath;
            }
        } else {
            // Check for raw uploaded image
            for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
                const candidate = path.join(EVENTS_IMAGES_DIR, `${slug}${ext}`);
                if (fs.existsSync(candidate)) {
                    needsCoverOptimization = true;
                    coverSourcePath = candidate;
                    break;
                }
            }
        }

        if (needsCoverOptimization && coverSourcePath) {
            console.log(`🖼️  Optimizing event cover for "${slug}" (${coverSourcePath})...`);
            await processEventCover(coverSourcePath, slug);
            coversOptimized++;
            if (path.resolve(coverSourcePath) !== path.resolve(targetCoverPath) && fs.existsSync(coverSourcePath)) {
                fs.unlinkSync(coverSourcePath);
            }
            frontmatter.image = `/images/events/${slug}.webp`;
        }

        // Badge extraction (events only)
        const badgePath = path.join(BADGES_DIR, `${slug}.webp`);
        const wantsBadge = frontmatter.badge === '' || (frontmatter.badge && typeof frontmatter.badge === 'string');

        if (wantsBadge && !fs.existsSync(badgePath)) {
            const currentCover = fs.existsSync(targetCoverPath) ? targetCoverPath : coverSourcePath;
            if (currentCover && fs.existsSync(currentCover)) {
                if (rembgAvailable) {
                    console.log(`🏅 Auto-generating badge for event "${slug}"...`);
                    try {
                        await generateBadgeFromCover(currentCover, slug);
                        badgesGenerated++;
                        frontmatter.badge = `/badges/${slug}.webp`;
                    } catch (err: any) {
                        console.error(`❌ Failed to auto-generate badge for ${slug}: ${err.message}`);
                    }
                } else {
                    console.warn(`⚠️ rembg not installed. Skipping auto-badge for ${slug}.`);
                }
            }
        }

        // Update frontmatter across locales if needed
        for (const locFile of localizedFiles) {
            const updatedData = cleanFrontmatter({
                ...locFile.parsed.data,
                date: frontmatter.date || locFile.parsed.data.date,
                endDate: frontmatter.endDate || locFile.parsed.data.endDate,
                permanent: frontmatter.permanent !== undefined ? frontmatter.permanent : locFile.parsed.data.permanent,
                recurrent: frontmatter.recurrent !== undefined ? frontmatter.recurrent : locFile.parsed.data.recurrent,
                dayOfMonth: frontmatter.dayOfMonth !== undefined ? frontmatter.dayOfMonth : locFile.parsed.data.dayOfMonth,
                image: frontmatter.image || locFile.parsed.data.image,
                badge: frontmatter.badge !== undefined ? frontmatter.badge : locFile.parsed.data.badge,
            });
            const newContent = matter.stringify(locFile.parsed.content, updatedData);
            fs.writeFileSync(locFile.filePath, newContent);
        }
    }

    return { coversOptimized, badgesGenerated };
}

/**
 * Process blogs: frontmatter normalization (user_id from profile, date default) & image optimization
 */
async function processBlogs(targetSlugs: Set<string>, processAll: boolean) {
    if (!fs.existsSync(BLOGS_CONTENT_DIR)) return { blogImagesOptimized: 0 };

    // 1. Normalize frontmatter (user_id from profile URL / default, and date)
    const normalizedCount = normalizeBlogFiles(processAll ? undefined : targetSlugs);
    if (normalizedCount > 0) {
        console.log(`✨ [auto-process] Normalized frontmatter for ${normalizedCount} blog file(s).`);
    }

    if (processAll) {
        const count = await scanAndOptimizeAllBlogImages();
        return { blogImagesOptimized: count };
    }

    let blogImagesOptimized = 0;
    for (const slug of Array.from(targetSlugs)) {
        for (const loc of LOCALES) {
            const locPath = path.join(BLOGS_CONTENT_DIR, loc, `${slug}.md`);
            if (fs.existsSync(locPath)) {
                const raw = fs.readFileSync(locPath, 'utf8');
                const imgRegex = /!\[(.*?)\]\((.*?)\)/g;
                let match: RegExpExecArray | null;

                while ((match = imgRegex.exec(raw)) !== null) {
                    const imgUrl = match[2].trim().split(' ')[0];
                    if (imgUrl.startsWith('http')) continue;

                    const cleanName = imgUrl.replace(/^\/images\/blogs\//, '').replace(/^\/images\//, '');
                    const localFile = path.join(BLOGS_IMAGES_DIR, cleanName);

                    if (fs.existsSync(localFile)) {
                        const ext = path.extname(localFile).toLowerCase();
                        const size = fs.statSync(localFile).size;
                        if (ext !== '.webp' || size > MAX_COVER_BYTES) {
                            console.log(`🖼️  Optimizing blog image: ${cleanName}...`);
                            await optimizeBlogImage(localFile);
                            blogImagesOptimized++;
                        }
                    }
                }
            }
        }
    }

    return { blogImagesOptimized };
}

export async function autoProcess() {
    console.log('⚡ [auto-process] Scanning repository for changed events and blog assets...\n');

    const { eventSlugs, blogSlugs, processAll } = getChangedItems();

    if (!processAll) {
        if (eventSlugs.size > 0 && blogSlugs.size > 0) {
            console.error(
                '❌ [auto-process] Mixed content submission detected! Events and Blog Posts must be submitted in separate PRs.'
            );
            process.exit(1);
        }
        if (eventSlugs.size > 1) {
            console.error(
                `❌ [auto-process] Multiple events detected in a single submission (${Array.from(eventSlugs).join(', ')}). Only one event can be submitted per PR.`
            );
            process.exit(1);
        }
        if (blogSlugs.size > 1) {
            console.error(
                `❌ [auto-process] Multiple blog posts detected in a single submission (${Array.from(blogSlugs).join(', ')}). Only one blog post can be submitted per PR.`
            );
            process.exit(1);
        }
    }

    const eventResult = await processEvents(eventSlugs, processAll);
    const blogResult = await processBlogs(blogSlugs, processAll);

    console.log('\n🎉 [auto-process] Completed:');
    console.log(`   - Event Covers optimized: ${eventResult.coversOptimized}`);
    console.log(`   - Event Badges generated: ${eventResult.badgesGenerated}`);
    console.log(`   - Blog Images optimized: ${blogResult.blogImagesOptimized}\n`);
}

if (require.main === module) {
    autoProcess().catch((err) => {
        console.error('❌ [auto-process] Failed:', err);
        process.exit(1);
    });
}
