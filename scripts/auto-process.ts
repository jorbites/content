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

export function slugify(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function isGeneratedHashSlug(slug: string): boolean {
    const isHexHash = /^[0-9a-f]{10,32}$/i.test(slug) && !slug.includes('_') && !slug.includes('-');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    return isHexHash || isUuid;
}

function getChangedItems(): {
    eventSlugs: Set<string>;
    blogSlugs: Set<string>;
    changedBlogImages: Set<string>;
    changedEventImages: Set<string>;
    processAll: boolean;
} {
    const args = process.argv.slice(2);
    if (args.includes('--all')) {
        return {
            eventSlugs: new Set(),
            blogSlugs: new Set(),
            changedBlogImages: new Set(),
            changedEventImages: new Set(),
            processAll: true,
        };
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
            return {
                eventSlugs: new Set(),
                blogSlugs: new Set([explicitSlug]),
                changedBlogImages: new Set(),
                changedEventImages: new Set(),
                processAll: false,
            };
        }
        if (isEvent && !isBlog) {
            return {
                eventSlugs: new Set([explicitSlug]),
                blogSlugs: new Set(),
                changedBlogImages: new Set(),
                changedEventImages: new Set(),
                processAll: false,
            };
        }
        return {
            eventSlugs: new Set([explicitSlug]),
            blogSlugs: new Set([explicitSlug]),
            changedBlogImages: new Set(),
            changedEventImages: new Set(),
            processAll: false,
        };
    }

    const eventSlugs = new Set<string>();
    const blogSlugs = new Set<string>();
    const changedBlogImages = new Set<string>();
    const changedEventImages = new Set<string>();

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
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Event markdown (ONLY markdown files define event slugs)
                const eventMatch = trimmed.match(/^content\/events\/(?:es|ca|en)\/(.+)\.md$/);
                if (eventMatch) {
                    eventSlugs.add(eventMatch[1]);
                    continue;
                }
                // Event images & badges (assets, NOT event slugs!)
                const eventImgMatch = trimmed.match(/^(?:images\/events|badges)\/(.+)$/);
                if (eventImgMatch) {
                    changedEventImages.add(path.basename(eventImgMatch[1]));
                    continue;
                }

                // Blog markdown (ONLY markdown files define blog slugs)
                const blogMatch = trimmed.match(/^content\/blogs\/(?:es|ca|en)\/(.+)\.md$/);
                if (blogMatch) {
                    blogSlugs.add(blogMatch[1]);
                    continue;
                }

                // Blog images (assets, NOT blog slugs!)
                const blogImgMatch = trimmed.match(/^images\/blogs\/(.+)$/);
                if (blogImgMatch) {
                    changedBlogImages.add(path.basename(blogImgMatch[1]));
                    continue;
                }
            }
            if (
                eventSlugs.size > 0 ||
                blogSlugs.size > 0 ||
                changedBlogImages.size > 0 ||
                changedEventImages.size > 0
            ) {
                break;
            }
        } catch {}
    }

    // Always inspect working tree status (for untracked or renamed files)
    try {
        const status = execSync('git status --porcelain', {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        for (const line of status.split('\n')) {
            const file = line.trim().slice(3).trim();
            if (!file) continue;

            const eventMatch = file.match(/^content\/events\/(?:es|ca|en)\/(.+)\.md$/);
            if (eventMatch) {
                eventSlugs.add(eventMatch[1]);
                continue;
            }
            const eventImgMatch = file.match(/^(?:images\/events|badges)\/(.+)$/);
            if (eventImgMatch) {
                changedEventImages.add(path.basename(eventImgMatch[1]));
                continue;
            }

            const blogMatch = file.match(/^content\/blogs\/(?:es|ca|en)\/(.+)\.md$/);
            if (blogMatch) {
                blogSlugs.add(blogMatch[1]);
                continue;
            }

            const blogImgMatch = file.match(/^images\/blogs\/(.+)$/);
            if (blogImgMatch) {
                changedBlogImages.add(path.basename(blogImgMatch[1]));
                continue;
            }
        }
    } catch {}

    // Filter out event/blog slugs that do not exist on disk in any locale (e.g. deleted or already renamed)
    for (const slug of Array.from(eventSlugs)) {
        const exists = LOCALES.some((loc) =>
            fs.existsSync(path.join(EVENTS_CONTENT_DIR, loc, `${slug}.md`))
        );
        if (!exists) {
            eventSlugs.delete(slug);
        }
    }

    for (const slug of Array.from(blogSlugs)) {
        const exists = LOCALES.some((loc) =>
            fs.existsSync(path.join(BLOGS_CONTENT_DIR, loc, `${slug}.md`))
        );
        if (!exists) {
            blogSlugs.delete(slug);
        }
    }

    // If an image changed without markdown, map to matching event slug if possible
    if (eventSlugs.size === 0 && changedEventImages.size > 0) {
        for (const imgName of Array.from(changedEventImages)) {
            const base = imgName.replace(/\.(png|jpe?g|webp)$/i, '');
            if (fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'es', `${base}.md`))) {
                eventSlugs.add(base);
            }
        }
    }

    return { eventSlugs, blogSlugs, changedBlogImages, changedEventImages, processAll: false };
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

    for (let slug of slugsToProcess) {
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
                if (val !== undefined && val !== null && combinedFrontmatter[key] === undefined) {
                    if (typeof val === 'string' && val.trim() === '') {
                        if (key === 'badge') combinedFrontmatter[key] = '';
                    } else {
                        combinedFrontmatter[key] = val;
                    }
                }
            }
        }
        frontmatter = combinedFrontmatter;

        // Auto-rename hash slugs (e.g. 57581ba97eca) to clean title slug
        const candidateTitle =
            localizedFiles.find((f) => f.locale === 'es' && f.parsed.data.title?.trim())?.parsed.data.title ||
            localizedFiles.find((f) => f.locale === 'ca' && f.parsed.data.title?.trim())?.parsed.data.title ||
            localizedFiles.find((f) => f.locale === 'en' && f.parsed.data.title?.trim())?.parsed.data.title ||
            combinedFrontmatter.title ||
            '';

        if (isGeneratedHashSlug(slug) && candidateTitle) {
            let newSlug = slugify(candidateTitle);
            if (newSlug && newSlug !== slug) {
                // Safeguard against overwriting an existing event
                if (
                    fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'es', `${newSlug}.md`)) ||
                    fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'ca', `${newSlug}.md`)) ||
                    fs.existsSync(path.join(EVENTS_CONTENT_DIR, 'en', `${newSlug}.md`))
                ) {
                    newSlug = `${newSlug}_${slug.slice(0, 6)}`;
                }

                console.log(`🏷️  Renaming event slug from "${slug}" to "${newSlug}" (derived from title "${candidateTitle}")...`);

                for (const locFile of localizedFiles) {
                    const newLocPath = path.join(EVENTS_CONTENT_DIR, locFile.locale, `${newSlug}.md`);
                    if (fs.existsSync(locFile.filePath)) {
                        fs.renameSync(locFile.filePath, newLocPath);
                        locFile.filePath = newLocPath;
                    }
                }

                // Rename existing cover if present (all common image extensions)
                for (const ext of ['.webp', '.png', '.jpg', '.jpeg']) {
                    const oldCover = path.join(EVENTS_IMAGES_DIR, `${slug}${ext}`);
                    const newCover = path.join(EVENTS_IMAGES_DIR, `${newSlug}${ext}`);
                    if (fs.existsSync(oldCover)) {
                        fs.renameSync(oldCover, newCover);
                    }
                }

                // Rename existing badge if present (all common image extensions)
                for (const ext of ['.webp', '.png', '.jpg', '.jpeg']) {
                    const oldBadge = path.join(BADGES_DIR, `${slug}${ext}`);
                    const newBadge = path.join(BADGES_DIR, `${newSlug}${ext}`);
                    if (fs.existsSync(oldBadge)) {
                        fs.renameSync(oldBadge, newBadge);
                    }
                }

                slug = newSlug;
            }
        }

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
        }

        // Check if frontmatter.image points to an existing file in images/events/ that needs optimization or renaming
        if (!coverSourcePath && frontmatter.image && typeof frontmatter.image === 'string') {
            const cleanImageName = frontmatter.image
                .replace(/^\/images\/events\//, '')
                .replace(/^\/images\//, '');
            const candidate = path.join(EVENTS_IMAGES_DIR, cleanImageName);
            if (fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(targetCoverPath)) {
                needsCoverOptimization = true;
                coverSourcePath = candidate;
            }
        }

        // Check for raw uploaded image matching slug
        if (!coverSourcePath) {
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
        } else if (fs.existsSync(targetCoverPath)) {
            frontmatter.image = `/images/events/${slug}.webp`;
        }

        // Badge extraction (events only)
        const badgePath = path.join(BADGES_DIR, `${slug}.webp`);
        const wantsBadge =
            frontmatter.badge === undefined ||
            frontmatter.badge === null ||
            frontmatter.badge === '' ||
            (typeof frontmatter.badge === 'string' &&
                (!frontmatter.badge.endsWith('.webp') ||
                    frontmatter.badge === `/badges/${slug}.webp`));

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
        } else if (fs.existsSync(badgePath)) {
            frontmatter.badge = `/badges/${slug}.webp`;
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
async function processBlogs(
    targetSlugs: Set<string>,
    changedBlogImages: Set<string>,
    processAll: boolean
) {
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
    const handledImages = new Set<string>();
    const processedSlugs = new Set<string>();

    for (let slug of Array.from(targetSlugs)) {
        if (isGeneratedHashSlug(slug)) {
            let candidateTitle = '';
            for (const loc of ['es', 'ca', 'en']) {
                const locPath = path.join(BLOGS_CONTENT_DIR, loc, `${slug}.md`);
                if (fs.existsSync(locPath)) {
                    try {
                        const parsed = matter(fs.readFileSync(locPath, 'utf8'));
                        if (parsed.data.title && typeof parsed.data.title === 'string' && parsed.data.title.trim()) {
                            candidateTitle = parsed.data.title.trim();
                            break;
                        }
                    } catch {}
                }
            }

            if (candidateTitle) {
                let newSlug = slugify(candidateTitle);
                if (newSlug && newSlug !== slug) {
                    // Safeguard against overwriting an existing blog post
                    if (
                        fs.existsSync(path.join(BLOGS_CONTENT_DIR, 'es', `${newSlug}.md`)) ||
                        fs.existsSync(path.join(BLOGS_CONTENT_DIR, 'ca', `${newSlug}.md`)) ||
                        fs.existsSync(path.join(BLOGS_CONTENT_DIR, 'en', `${newSlug}.md`))
                    ) {
                        newSlug = `${newSlug}_${slug.slice(0, 6)}`;
                    }

                    console.log(`🏷️  Renaming blog slug from "${slug}" to "${newSlug}" (derived from title "${candidateTitle}")...`);
                    for (const loc of LOCALES) {
                        const oldLocPath = path.join(BLOGS_CONTENT_DIR, loc, `${slug}.md`);
                        const newLocPath = path.join(BLOGS_CONTENT_DIR, loc, `${newSlug}.md`);
                        if (fs.existsSync(oldLocPath)) {
                            fs.renameSync(oldLocPath, newLocPath);
                        }
                    }
                    slug = newSlug;
                }
            }
        }
        processedSlugs.add(slug);

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

                    if (fs.existsSync(localFile) && !handledImages.has(cleanName)) {
                        handledImages.add(cleanName);
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

    // Also optimize any changed images that weren't already handled from markdown references
    for (const imgName of Array.from(changedBlogImages)) {
        if (handledImages.has(imgName)) continue;
        const localFile = path.join(BLOGS_IMAGES_DIR, imgName);
        if (fs.existsSync(localFile)) {
            handledImages.add(imgName);
            const ext = path.extname(localFile).toLowerCase();
            const size = fs.statSync(localFile).size;
            if (ext !== '.webp' || size > MAX_COVER_BYTES) {
                console.log(`🖼️  Optimizing blog image: ${imgName}...`);
                await optimizeBlogImage(localFile);
                blogImagesOptimized++;
            }
        }
    }

    return { blogImagesOptimized };
}

export async function autoProcess() {
    console.log('⚡ [auto-process] Scanning repository for changed events and blog assets...\n');

    const { eventSlugs, blogSlugs, changedBlogImages, changedEventImages, processAll } = getChangedItems();

    if (!processAll) {
        const hasEvents = eventSlugs.size > 0 || changedEventImages.size > 0;
        const hasBlogs = blogSlugs.size > 0 || changedBlogImages.size > 0;

        if (hasEvents && hasBlogs) {
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
    const blogResult = await processBlogs(blogSlugs, changedBlogImages, processAll);

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
